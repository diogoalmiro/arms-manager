const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_FOLDER = path.join(process.env.APPDATA, "arms-app")
const LOG_FOLDER = path.join(APP_FOLDER, "logs");

fs.mkdirSync(LOG_FOLDER, { recursive: true });

const { writeFileSync, readFileSync } = require("fs");
writeFileSync(path.join(APP_FOLDER, 'favicon.ico'), readFileSync(path.join(__dirname, 'node_modules/@webfocus/app/static/favicon.ico')))

const logname = Date.now().toString();

const stdout = fs.openSync(path.join(LOG_FOLDER, logname+ "_stdout.log"), 'w')
const stderr = fs.openSync(path.join(LOG_FOLDER, logname+ "_stderr.log"), 'w')

const child = child_process.fork(path.join(__dirname,'main.js'), {
    stdio: ['ignore', stdout, stderr, 'ipc'],
    detached: true,

    env: { DEBUG: 'webfocus:*', ...process.env }
});

child.unref();
process.exit(0);
