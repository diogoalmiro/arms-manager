const child_process = require("child_process");
const debug = require("debug")("webfocus:component:docker");
const {promisify} = require('util');
const pexec =  promisify(child_process.exec);
const hideShell = { windowsHide: true, shell: false }
const exec = (cmd) => pexec(cmd, hideShell).catch(e => {
    debug("docker cmd \"%s\" failed: %s", cmd, e.message)
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

/**
 * Creates an eventEmitter for the docker events of a container with our image
 * @returns the eventEmitter
 */
module.exports.watch = () => {
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
    return emitter;
}

/**
 * 
 * @param {Settings} settings
 * @returns A promise
 */
module.exports.create = (settings) => {
    let flags = []
    flags.push(settings.comp ? '--comp' : '--no-comp')
    flags.push(settings.prep ? '--prep' : '--no-prep')
    for(let lang of settings.lang){
        flags.push(`--lang ${lang}`)
    }
    return exec(`docker create -v "${settings.folder}:/input/" --name ${settings.task} ${IMAGE_NAME} python3 workflow.py /input/ ${flags.join(' ')}`);
}

/**
 * Pauses a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.pause = (settings) => exec(`docker pause ${settings.task}`);

/**
 * Unpauses a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.unpause = (settings) => exec(`docker unpause ${settings.task}`);

/**
 * Starts a container
 * @param {Settings} settings 
 * @returns A promise 
 */
module.exports.start = (settings) => exec(`docker start ${settings.task}`);

/**
 * Stops a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.stop = (settings) => exec(`docker stop ${settings.task}`);

/**
 * Deletes a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.delete = (settings) => exec(`docker rm ${settings.task}`);

/**
 * @param {Settings} settings 
 * @returns A promise with the JSON representing the inspected container
 */
module.exports.inspect = (settings) => exec(`docker container inspect --format "{{json .}}" ${settings.task}`).then(maybeObj => maybeObj ? JSON.parse(maybeObj.stdout) : null);

/**
 * Renames a container
 * @param {string} oldname 
 * @param {string} newname 
 * @returns 
 */
module.exports.rename = (oldname, newname) => exec(`docker container rename ${oldname} ${newname}`);

/**
 * Returns the stdout and stderr of a container
 * @param {Settings} settings 
 * @returns 
 */
module.exports.logs = (settings) => exec(`docker logs ${settings.task}`).then(maybeObj => maybeObj ? maybeObj : {stderr:"", stdout:""});