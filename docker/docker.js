const child_process = require("child_process");
const debug = require("debug")("webfocus:component:docker");
const {promisify} = require('util');
const pexec =  promisify(child_process.exec);
const hideShell = { windowsHide: true, shell: false }
const exec = (cmd) => pexec(cmd, hideShell).catch(e => {
    debug(e.message);
    return null;
});
const EventEmitter = require("events").EventEmitter;

const URL = "https://github.com/diogoalmiro/arms_docker.git#main"
const IMAGE_NAME = "arms-automatic-docker-image";

/**
 * Builds/Updates the docker image
 * @returns A promise
 */
module.exports.build = () => {
    debug("Building/Updating docker image from %s", URL);
    return exec(`docker build -t ${IMAGE_NAME} ${URL}`);
}

let _emitter;
/**
 * Creates an eventEmitter for the docker events of a container with our image
 * @returns the eventEmitter
 */
module.exports.watch = () => {
    if( _emitter ) return _emitter;
    debug("Watching docker events");
    const emitter = new EventEmitter();
    const watcher = child_process.exec(`docker events --format "{{json .}}" --filter "image=${IMAGE_NAME}"`, hideShell);
    let lastLine = '';
    watcher.stderr.on('data', (part) => {
        emitter.emit("stderr", part);
    });
    watcher.stdout.on('data', (part) => {
        lastLine += part.toString();
        jsons = lastLine.split('\n');
        lastLine = jsons.pop();
        for(let jsonString of jsons){
            let jsonObj = JSON.parse(jsonString);
            emitter.emit(jsonObj.status, jsonObj);
        }
    });
    return _emitter = emitter;
}

/**
 * 
 * @param {Settings} settings
 * @returns A promise with the containr id
 */
module.exports.create = (settings) => {
    let flags = []
    flags.push(settings.comp ? '--comp' : '--no-comp')
    flags.push(settings.prep ? '--prep' : '--no-prep')
    for(let lang of settings.lang){
        flags.push(`--lang ${lang}`)
    }
    return exec(`docker create -v "${settings.folder}:/input/" ${IMAGE_NAME} python3 workflow.py /input/ ${flags.join(' ')}`).then(maybeObj => maybeObj ? maybeObj.stdout.trim() : null)
}

/**
 * Pauses a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.pause = (settings) => exec(`docker pause ${settings.docker}`);

/**
 * Unpauses a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.unpause = (settings) => exec(`docker unpause ${settings.docker}`);

/**
 * Starts a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.start = (settings) => exec(`docker start ${settings.docker}`);

/**
 * Stops a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.stop = (settings) => exec(`docker stop ${settings.docker}`);

/**
 * Deletes a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.delete = (settings) => exec(`docker rm ${settings.docker}`);

/**
 * @param {Settings} settings 
 * @returns A promise with the JSON representing the inspected container
 */
module.exports.inspect = (settings) => exec(`docker container inspect --format "{{json .}}" ${settings.docker}`).then(maybeObj => maybeObj ? JSON.parse(maybeObj.stdout) : null);

/**
 * Returns the stdout and stderr of a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.logs = (settings) => exec(`docker logs ${settings.docker}`).then(maybeObj => maybeObj ? maybeObj : {stderr:"", stdout:""});