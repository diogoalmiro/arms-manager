const path = require('path');
const open = require("open");
const debug = require("debug")("webfocus:main");
const WebfocusApp = require('@webfocus/app');

let configuration = {
    port : 8006, // Specify your port here
    name : "ARMS Manager",
    // Add more configurations here
    views : path.join(__dirname, 'node_modules/@webfocus/app/views'),
    static : path.join(__dirname, 'node_modules/@webfocus/app/static')
}

let webfocusApp = new WebfocusApp( configuration );

// Register webfocus/app comonents here
// e.g. webfocusApp.registerComponent(require('../component-example'));
webfocusApp.registerComponent(require('./docker'));
webfocusApp.registerComponent(require('@webfocus/util/component'));

let mailComponent = require('@webfocus/send-mail');
const docker = require('./docker');
webfocusApp.registerComponent(mailComponent);
mailComponent.readMailConfig().then(async config => {
    if( !config.host ){
        await mailComponent.setMailConfig({
            host: "mx7.un.org",
            port: 25,
            auth: {
                user: "",
                pass: ""
            }
        })
    }
})

let settings = require("@webfocus/tray");
webfocusApp.registerComponent(settings);

let server = webfocusApp.start();
settings.setIcon(path.join(require("app-data-folder")("arms-app"), 'favicon.ico'));
settings.setTitle(webfocusApp.configuration.name);
settings.addAction("Open Application", () => open(`http://localhost:${server.address().port}/`));
settings.addAction("Update Docker", () => require("./docker/docker").build().then(maybeNull => maybeNull ? debug("Build success") : debug("Build error")) );
settings.addAction("Open Logs", () => open(path.join(require("app-data-folder")("arms-app"), 'logs')));
settings.addAction("Close Applicarion", cleanExit);
settings.showTray();
server.once("listening", () => {
    open(`http://localhost:${server.address().port}`);
})
server.once("error", (err) => {
    let errorFilePath = path.join(require("app-data-folder")("arms-app"),`server-error.html`);
    let errorFile = require("fs").createWriteStream(errorFilePath);
    errorFile.write(`
<h1 style="color:darkred">ARMS Manager Application Error</h1>
<p>ARMS Manager main application emitted an error.</p>
<p>This might be because another application is already using the application port 8006.</p>
<p>Please check if there is another programm running a server and stop it. Afterwards try again.</p>
<p><a href="./logs/">Logs are available here.</a></p>
<p>Error details:</p>
<pre>${JSON.stringify(err, null, "  ")}</pre>`, (subError) => {
        if( !subError ){
            errorFile.end( () => {
                debug("Open Error File %s", errorFilePath);
                open(errorFilePath, {wait: true}).catch(e => debug(e)).finally(() => {
                    cleanExit()
                    })
                })
        }
        else{
            debug("Writing Error File: %s", subError.message);
            cleanExit();
        }
    }); 
})

function cleanExit(){
    debug("Clean Exit");
    try{require("./docker/docker").unwatch()}catch(e){debug("  unwatch docker: %O", e)}
    try{settings.closeTray()}catch(e){debug("  close tray: %O", e)}
    try{server.close()}catch(e){debug("  close server: %O", e)}
    debug("Done");
    process.exit();
}