const component = module.exports = require("@webfocus/component")("Task Manager", "Manage tasks.")

const child_process = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const Settings = require('./settings');
const pagination = require("@webfocus/util/util").pagination;
const {promisify} = require('util');
const exec =  promisify(require('child_process').exec);

const drivelist = require("drivelist");


const IDLE_TIME = 1000;
const TASK_FOLDER = path.join(process.env.APPDATA, "webfocus-component-docker/tasks");
fs.mkdir(TASK_FOLDER, { recursive: true });
Settings.basedir = TASK_FOLDER;

async function taskInfo(taskName){
    return {
        task: taskName,
        settings: Settings.read(taskName),
        docker: await exec(`docker container inspect --format "{{json .}}" ${taskName}`, { windowsHide: true, shell: false }).then(({stdout}) => JSON.parse(stdout)).catch(e => null)
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

component.app.get("/", pagination(allTasksInfo));
component.staticApp.get('/task', async (req, res, next) => {
    component.task = await taskInfo(req.query.id)
    component.task.logs = await exec(`docker logs ${req.query.id}`).then(({stdout}) => stdout).catch(e => "");
    next()
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

        let settings = Settings.create(Date.now().toString(), req.body.path, req.body.path);
        
        settings.comp = 'comp' in req.body;
        settings.prep = 'prep' in req.body;
        settings.lang = req.body['lang'] || ["eng"];
        settings.priority = parseInt(req.body["priority"] || 1)

        Settings.update(settings.task, settings)
        res.redirect(`/${component.urlname}/`)
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
    let {settings, docker} = await taskInfo(task);
    component.debug('Updating settings')
    if( !!docker ) return next(new Error("Cannot update task after docker container was created."))
    if( !settings ) return next(new Error("Task not found. Please Create a new task."))
    component.debug('Updating settings')
    
    settings.comp = 'comp' in req.body;
    settings.prep = 'prep' in req.body;
    settings.lang = req.body['lang'];
    if( !settings.lang ) settings.lang = "eng"
    if( !Array.isArray(settings.lang) ) settings.lang = [settings.lang];
    settings.priority = parseInt(req.body["priority"] || 2)
    
    Settings.update(task, settings)
})

action("stop", async (task, req, res, next) => {
    let {settings, docker} = await taskInfo(task);
    if( !docker ) return next(new Error("Cannot stop task. Container not found."));
    if( docker.State.Status == "running" ){
        child_process.execSync(`docker pause ${task}`);
    }
    settings.userPaused = true;
    Settings.update(settings.task, settings);
})

action("run", async (task, req, res, next) => {
    let {docker} = await taskInfo(task);
    if( !docker ){
        await ACTIONS["save"](task, req, res, next)
        let settings = Settings.read(task);
        let flags = [];
        if( settings.comp ) flags.push('--comp');
        if( settings.prep ) flags.push('--prep');
        for( let lang of settings.lang ) flags.push(`--lang ${lang}`);
        child_process.execSync(`docker create -v "${settings.input}":/input -v "${settings.output}":/arms_docker-main/workflow/results/input --name ${settings.task} ${IMAGE_NAME} python3 workflow.py --folder /input ${flags.join(' ')}`)
    }
    else{
        if(docker.State.Status == 'running'){
            return next(new Error("Container already running."))
        }
        else if( docker.State.Status == 'paused' ){
            let settings = Settings.read(task)
            settings.userPaused = false;
            Settings.update(settings.task, settings);
        }
        else{
            return next(new Error("Unhandled container status. (container status: '"+docker.State.Status+"')"))
        }
    }
})

action("delete", async (task, req, res, next) => {
    let {settings, docker} = await taskInfo(task);
    if( docker && (docker.State.Status == 'running' || docker.State.Status == 'paused') ){
        child_process.execSync(`docker stop ${task}`);
    }
    if(docker){
        child_process.execSync(`docker container rm ${task}`);
        settings.userPaused = false;
        Settings.update(settings.task, settings);
    }
    if( !docker ){
        Settings.delete(task);
    }
})

action("rename", async (task, req, res, next) => {
    let {settings, docker} = await taskInfo(task);
    if( docker ){
        child_process.execSync(`docker container rename ${task} ${req.body.newname}`)
    }
    if( settings ){
        let settings = Settings.read(task);
        Settings.delete(task);
        settings.task = req.body.newname;
        Settings.create(req.body.newname, settings.input, settings.output, settings);
    }
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

// Ensure our image exists in host computer
const IMAGE_NAME = require('./create-local-dockerfile');
setImmediate(loop)

async function loop(){
    let tasks = await allTasksInfo();
    let nextTask = null;
    for(let task of tasks ){
        if( !task.docker ) continue;
        if( task.docker.State.Status == 'running' ){
            nextTask = null;
            break;
        }
        if( task.docker.State.Status == 'created' || task.docker.State.Status == 'paused' && !task.settings.userPaused ){
            if(!nextTask){
                nextTask = task;
            }
            if( new Date(nextTask.docker.Created) > new Date(task.docker.Created) && nextTask.settings.priority <= task.settings.priority ){
                nextTask = task;
            }
        }
    }
    if( nextTask == null ) return setTimeout(loop, IDLE_TIME);

    await exec(`docker ${nextTask.docker.State.Status == 'paused' ? 'unpause' : 'start'} ${nextTask.task}`).catch(e => component.warn("Loop error: %O", e)).then(loop)
}

/*
async function getNextTaskSettings(){
    let next = null;
    for(let task of await fs.readdir(TASK_FOLDER)){
        let settings = Settings.read(task);
        if( settings.task != task  || settings.currentStatus != Settings.STATUS.QUEUED ) continue;
        if( next == null ) next = settings;
        if( next.priority < settings.priority ) next = settings;
        if( new Date(next.queued) > new Date(settings.queued) ) next = settings;
    }
    return next;
}

function checkDocker(){
    return new Promise((resolve) => {
        let p = child_process.exec(`docker container ls  --format='{{json .}}'`);
        let data = "";
        p.stdout.on('data', d => data+= d.toString());
        p.stdout.on('end', _ => {
            resolve();
        })
    })
}
*/
/*
const watcher = child_process.exec(`docker events --format "{{json .}}" --filter "image=${IMAGE_NAME}" --filter "type=container"`)
let lastLine = '';
watcher.stderr.on('data', (part) => {
    console.error('docker events error')
    console.error(part)
    throw new Error(part)
})
watcher.stdout.on('data', (part) => {
    lastLine += part.toString();
    jsons = lastLine.split('\n')
    lastLine = jsons.pop();
    for(let json of jsons){
        component.emit('dockerEvent', JSON.parse(json))
        component.debug('dockerEvent %O', JSON.parse(json))
    }
})
*/

/*
fs.readdir(TASK_FOLDER).then(tasks => {
    for(let task of tasks){
        let settings = Settings.read(task);
        if( settings.currentStatus == Settings.STATUS.RUNNING ){
            settings.currentStatus = Settings.STATUS.QUEUED;
            Settings.update(task, settings);
        } 
    }
    //loop(); // Start loop worker
})
*/