const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_FOLDER = require("app-data-folder")("arms-app")
const LOG_FOLDER = path.join(APP_FOLDER, "logs");

fs.mkdirSync(LOG_FOLDER, { recursive: true });

const { writeFileSync, readFileSync } = require("fs");
writeFileSync(path.join(APP_FOLDER, 'favicon.ico'), readFileSync(path.join(__dirname, 'node_modules/@webfocus/app/static/favicon.ico')))

const logname = Date.now().toString();

const debugFile = fs.openSync(path.join(LOG_FOLDER, logname+ ".log"), 'w');

fs.writeSync(debugFile, "# package.json:\n")
fs.writeSync(debugFile, "# " + JSON.stringify(require("./package.json"))+ "\n");
fs.writeSync(debugFile, "# process.env:\n");
fs.writeSync(debugFile, "# " + JSON.stringify(process.env) + "\n");
try{
    fs.writeSync(debugFile, "# docker version\n");
    fs.writeSync(debugFile, child_process.execSync("docker version").toString())
}
catch(e){
    fs.writeSync(debugFile, "# "+e.message+"\n");
    fs.writeSync(debugFile, "# "+e.stderr.toString()+"\n");
}
fs.writeSync(debugFile, "# === STARTING APPLICATION ===\n");

const child = child_process.fork(path.join(__dirname,'main.js'), {
    stdio: ['ignore', debugFile, debugFile, 'ipc'],
    detached: true,
    windowsHide: true,
    shell: false,
    env: { DEBUG: 'webfocus:*', ...process.env }
});

child.unref();
process.exit(0);
