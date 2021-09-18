// Create component
const component = module.exports = require("@webfocus/component")("Task Manager", "Manage tasks.")

// Dependencies
const path = require("path");
const fs = require("fs/promises");
const Settings = require('./settings');
const util = require("@webfocus/util");
const open = require('open');
const drivelist = require("drivelist");
const docker = require("./docker");

const TASK_FOLDER = path.join(component.folder, "tasks");
Settings.basedir = TASK_FOLDER;

const dockerEvents = docker.watch();
dockerEvents.on('die', runNextTask)
dockerEvents.on('pause', runNextTask)

// Ensure TASK_FOLDER and docker image exist
component.debug("mkdir \"%s\"", TASK_FOLDER)
fs.mkdir(TASK_FOLDER, { recursive: true }).then(async _ => {
    if( await docker.build() ){
        component.debug("Docker build successfuly")
    }
    else{
        component.debug("Docker build with errors")
    }
    runNextTask()
}).catch(e => component.debug("Error: %O"))

component.once('webfocusApp', (webfocusApp) => {
    dockerEvents.on('die', (evt) => {
        if( typeof webfocusApp.sendMail !== 'function' ){ return; }
        
        let settings = Settings.read(evt.Actor.Attributes.name);
        if( !settings.mail ){ return; }
        component.debug("Component died. Notifying by email. %s", settings.mail)

        let text = '';
        if( evt.Actor.Attributes.exitCode == 0 ){
            text = `Hello,\nThe task "${settings.task}" just terminated with success.\nAll files are available at the folder ${evt.Actor.Attributes["desktop.docker.io/binds/0/Source"]}.\nWebfocus ARMS`
        }
        else{
            text = `Hello,\nThe task "${settings.task}" just terminated with the error code ${evt.Actor.Attributes.exitCode}. This means that something went wrong with some file(s). The logs are available at the web application.\nThe files are available at the folder ${evt.Actor.Attributes["desktop.docker.io/binds/0/Source"]}.\nWebfocus ARMS`
        }            
        webfocusApp.sendMail({
            to: settings.mail,
            subject: `OCR Task ${settings.task} - Terminated (Exit code: ${evt.Actor.Attributes.exitCode})`,
            text: text
        })
        .then(_ => component.debug("Send mail successful"))
        .catch(e => component.debug("Send mail error: %O", e))
    })
})

component.app.get("/events", util.serversideevents(dockerEvents, ["pause","die","unpause","start","create","stop","rename"]))
component.app.get("/", util.pagination(allTasksInfo));
component.staticApp.get('/task', async (req, res, next) => {
    component.task = await taskInfo(req.query.id)
    if( !component.task.settings ) return next(new Error("Task not found"))
    component.task.logs = await docker.logs(component.task.settings)
    next()
})

component.app.get("/open-folder", async (req, res) => {
    open(req.query.path)
    res.redirect(req.headers.referer)
})

component.staticApp.get("/select-folder", async (req, res, next) => {
    try{
        if( req.query.path ){
            let entries = await fs.readdir(req.query.path, { withFileTypes: true });
            req.folders = entries.filter(e => e.isDirectory()).map(e => path.join(req.query.path, e.name))
            req.files = entries.filter(e => e.isFile())
            req.up = path.join(req.query.path, '..')
            if( req.up == req.query.path ) req.up=''
        }
        else{
            let drives = await drivelist.list();
            req.folders = drives.map(d => d.mountpoints).flat().map(m => m.path);
            req.files = []
            req.up = ''
        }
        next()
    }
    catch(e){
        next(e)
    }
})

component.app.post("/create", async (req, res, next) => {
    component.debug("Creating task.")
    try{
        fs.stat(req.body.path)
        let settings = Settings.create(Date.now().toString(), req.body.path);
        res.redirect(`/${component.urlname}/task?id=${settings.task}`)
    }
    catch(e){
        next(e)
    }
})

/*
 * === Available actions ===
 */
const ACTIONS = {};
function action(action, cb){
    ACTIONS[action] = cb;
}

action("save",async (task, req, res, next) => {
    component.debug('Updating settings')
    let {settings, docker: dockerObj} = await taskInfo(task);
    if( !settings ) return next(new Error("Task not found. Please Create a new task."));
    
    if( !dockerObj ){
        settings.comp = 'comp' in req.body;
        settings.prep = 'prep' in req.body;
        settings.lang = req.body['lang'];
        if( !settings.lang ) settings.lang = "eng"
        if( !Array.isArray(settings.lang) ) settings.lang = [settings.lang];
        settings.priority = parseInt(req.body["priority"] || 2)    
    }
    settings.mail = req.body['mail'] || ""
    
    Settings.update(task, settings)
    if( req.body.newname && req.body.newname.length > 0 ){
        if( !dockerObj || await docker.rename(task, req.body.newname) ){
            settings.task = req.body.newname;
            Settings.create(req.body.newname, settings.folder, settings);
            Settings.delete(task);
        }
        
    }
    res.redirect(`/${component.urlname}/task?id=${settings.task}`)
})

action("stop", async (task, req, res, next) => {
    let {settings, docker: dockerObj} = await taskInfo(task);
    settings.userPaused = true;
    Settings.update(settings.task, settings);
    if( dockerObj && dockerObj.State.Status == "running" ){
        await docker.pause(settings)
    }
})

action("run", async (task, req, res, next) => {
    await ACTIONS["save"](task, req, res, next)
    let {settings, docker: dockerObj} = await taskInfo(task);
    if( !dockerObj ){
        await docker.create(settings);
    }
    if( settings ){
        settings.userPaused = false;
        Settings.update(settings.task, settings);
    }
    runNextTask() // Try to start a new container now
})

action("delete", async (task, req, res, next) => {
    let {settings, docker: dockerObj} = await taskInfo(task);
    if( dockerObj && (dockerObj.State.Status == 'running' || dockerObj.State.Status == 'paused') ){
        await docker.stop(settings);
    }
    if(dockerObj){
        await docker.delete(settings);
        settings.userPaused = false;
        Settings.update(settings.task, settings);
    }
    if( !dockerObj ){
        Settings.delete(task);
    }
    res.redirect(`/${component.urlname}/`)
})

component.app.post("/task", (req, res, next) => {
    let action = req.body.action;
    if( !action ) return next(new Error("'action' parameter needs to be defined."));
    if( !(action in ACTIONS) )  return next(new Error("Value o 'action' parameter is invalid, (action='"+action+"')"));
    let task = req.body.task;
    if( !task ) return next(new Error("'task' parameter needs to be defined."));

    component.debug("'%s' on task %s.", action, task);
    let called = false;
    let checkNext = (...args) => {called = true; next(...args)}
    ACTIONS[action](task, req, res, checkNext).then( _ => {
        if( !called && !res.headersSent ){
            res.redirect(req.headers.referer)
        }
    }).catch(next)
})

async function runNextTask(){
    let tasks = await allTasksInfo();
    let nextTask = null;
    for( let task of tasks ){
        if( !task.docker || task.settings.userPaused ) continue;
        if( task.docker.State.Status == 'running' ){
            return null;
        }
        if( task.docker.State.Status == 'created' || task.docker.State.Status == 'paused' ){
            if( !nextTask ){
                nextTask = task
            }
            if( nextTask.settings.priority < task.settings.priority ){
                nextTask = task;
            }
            if( nextTask.settings.priority == task.settings.priority ){
                if( new Date(nextTask.docker.Created) > new Date(task.docker.Created) ){
                    nextTask = task;
                }
            }
        }
    }
    if( nextTask ){
        component.debug("Next task: %s", nextTask.task)
        if( nextTask.docker.State.Status == 'paused' ){
            await docker.unpause(nextTask.settings)
        }
        else{
            await docker.start(nextTask.settings);
        }
    }
}

async function taskInfo(taskName){
    let settings = Settings.read(taskName);
    return {
        task: taskName,
        settings: settings,
        docker: settings ? await docker.inspect(settings) : null
    }
}

async function allTasksInfo(){
    let tasks = await fs.readdir(TASK_FOLDER);
    let ret = [];
    for(let task of tasks){
        ret.push(await taskInfo(task));
    }
    return ret;
}