const component = module.exports = require("@webfocus/component")("Task Manager", "Manage tasks.")

const child_process = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const Settings = require('./settings');
const pagination = require("@webfocus/util/util").pagination;
const {promisify} = require('util');
const exec =  promisify(require('child_process').exec);
const open = require('open');
const drivelist = require("drivelist");
const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
    host: "mx7.un.org",
    port: 25
})


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
    if( !component.task.settings ) return next(new Error("Task not found"))
    component.task.logs = await exec(`docker logs ${req.query.id}`).then(({stdout}) => stdout).catch(e => "");
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
        await fs.mkdir(path.join(settings.folder,'out'), { recursive: true })
        child_process.execSync(`docker create -v "${settings.folder}":/input -v "${settings.folder}/out/":/arms_docker-main/workflow/results/input --name ${settings.task} ${IMAGE_NAME} python3 workflow.py --folder /input ${flags.join(' ')}`)
        runNextTask() // Try to start a new container now
    }
    else{
        if(docker.State.Status == 'running'){
            return next(new Error("Container already running."))
        }
        else if( docker.State.Status == 'paused' ){
            let settings = Settings.read(task)
            settings.userPaused = false;
            Settings.update(settings.task, settings);
            runNextTask() // Try to start a new container now
        }
        else if( docker.State.Status == 'exited' || docker.State.Status == 'created' ){
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
    res.redirect(`/${component.urlname}/`)
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
        Settings.create(req.body.newname, settings.folder, settings);
    }
    res.redirect(`/${component.urlname}/task?id=${req.body.newname}`)
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

async function runNextTask(){
    let tasks = await allTasksInfo();
    let nextTask = null;
    for( let task of tasks ){
        if( !task.docker ) continue;
        if( task.docker.State.Status == 'running' ){
            return null;
        }
        if( task.docker.State.Status == 'created' || task.docker.State.Status == 'paused' && !task.settings.userPaused ){
            if( !nextTask ){
                nextTask = task
            }
            if( new Date(nextTask.docker.Created) > new Date(task.docker.Created) && nextTask.settings.priority <= task.settings.priority ){
                nextTask = task;
            }
        }
    }
    if( nextTask ){
        await exec(`docker ${nextTask.docker.State.Status == 'paused' ? 'unpause' : 'start'} ${nextTask.task}`).catch(e => component.warn("docker unpause/start error: %O", e))
    }
}

const watcher = child_process.exec(`docker events --format "{{json .}}" --filter "image=${IMAGE_NAME}" --filter "type=container" --filter "event=pause" --filter="event=die"`)
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

component.on('dockerEvent', (evt) => {
    if( evt.status == 'die' || evt.status == 'pause' ){  // Start the next container when another ends or user Pauses it
        runNextTask();
    }
})


runNextTask() // Start the next container when starting the component

/**
 * dockerEvent examples:
 * {"status":"unpause","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"unpause","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630690875,"timeNano":1630690875216024500}
{"status":"create","id":"94a1d7331962a2ce79a9c9478f63b0cb84346447f95cbbccf2cab5f0f9652316","from":"arms-automatic-docker-image","Type":"container","Action":"create","Actor":{"ID":"94a1d7331962a2ce79a9c9478f63b0cb84346447f95cbbccf2cab5f0f9652316","Attributes":{"desktop.docker.io/binds/0/Source":"C:\\Users\\Diogo Almiro\\Desktop\\ARMS_FILES","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"C:\\Users\\Diogo Almiro\\Desktop\\ARMS_FILES/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630690960736"}},"scope":"local","time":1630690966,"timeNano":1630690966433753500}
{"status":"destroy","id":"94a1d7331962a2ce79a9c9478f63b0cb84346447f95cbbccf2cab5f0f9652316","from":"arms-automatic-docker-image","Type":"container","Action":"destroy","Actor":{"ID":"94a1d7331962a2ce79a9c9478f63b0cb84346447f95cbbccf2cab5f0f9652316","Attributes":{"desktop.docker.io/binds/0/Source":"C:\\Users\\Diogo Almiro\\Desktop\\ARMS_FILES","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"C:\\Users\\Diogo Almiro\\Desktop\\ARMS_FILES/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630690960736"}},"scope":"local","time":1630690971,"timeNano":1630690971478301900}
{"status":"kill","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"kill","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261","signal":"15"}},"scope":"local","time":1630690976,"timeNano":1630690976439148800}
{"status":"kill","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"kill","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261","signal":"9"}},"scope":"local","time":1630690986,"timeNano":1630690986641824600}
{"status":"die","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"die","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","exitCode":"137","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630690986,"timeNano":1630690986674968200}
{"status":"stop","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"stop","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630690986,"timeNano":1630690986936030200}
{"status":"destroy","id":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","from":"arms-automatic-docker-image","Type":"container","Action":"destroy","Actor":{"ID":"44df1afdb59ced2c27e877c1d0574bc8d9907256667a9c9efe279f6fce1d44ae","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630690987,"timeNano":1630690987542720100}


{"status":"start","id":"61a54d1cf73ead3f4fbddb354b1feec46507f4e645cd8c8647917258cab37b35","from":"arms-automatic-docker-image","Type":"container","Action":"start","Actor":{"ID":"61a54d1cf73ead3f4fbddb354b1feec46507f4e645cd8c8647917258cab37b35","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630691142,"timeNano":1630691142410573400}
{"status":"die","id":"61a54d1cf73ead3f4fbddb354b1feec46507f4e645cd8c8647917258cab37b35","from":"arms-automatic-docker-image","Type":"container","Action":"die","Actor":{"ID":"61a54d1cf73ead3f4fbddb354b1feec46507f4e645cd8c8647917258cab37b35","Attributes":{"desktop.docker.io/binds/0/Source":"D:\\diogoalmiro\\SMALL_BATCH","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"D:\\diogoalmiro\\SMALL_BATCH/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","exitCode":"0","image":"arms-automatic-docker-image","name":"1630671884261"}},"scope":"local","time":1630692698,"timeNano":1630692698925893800}

{"status":"create","id":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","from":"arms-automatic-docker-image","Type":"container","Action":"create","Actor":{"ID":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","Attributes":{"desktop.docker.io/binds/0/Source":"C:\\Intel\\gp","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"C:\\Intel\\gp/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630804755417"}},"scope":"local","time":1630804765,"timeNano":1630804765091533300}
{"status":"start","id":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","from":"arms-automatic-docker-image","Type":"container","Action":"start","Actor":{"ID":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","Attributes":{"desktop.docker.io/binds/0/Source":"C:\\Intel\\gp","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"C:\\Intel\\gp/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","image":"arms-automatic-docker-image","name":"1630804755417"}},"scope":"local","time":1630804769,"timeNano":1630804769717528700}
{"status":"die","id":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","from":"arms-automatic-docker-image","Type":"container","Action":"die","Actor":{"ID":"f88af06dcd174d0fcd38594bce1e75c4505bf930ed2b66d00373af29f3981192","Attributes":{"desktop.docker.io/binds/0/Source":"C:\\Intel\\gp","desktop.docker.io/binds/0/SourceKind":"hostFile","desktop.docker.io/binds/0/Target":"/input","desktop.docker.io/binds/1/Source":"C:\\Intel\\gp/out/","desktop.docker.io/binds/1/SourceKind":"hostFile","desktop.docker.io/binds/1/Target":"/arms_docker-main/workflow/results/input","exitCode":"0","image":"arms-automatic-docker-image","name":"1630804755417"}},"scope":"local","time":1630804772,"timeNano":1630804772090098900}
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