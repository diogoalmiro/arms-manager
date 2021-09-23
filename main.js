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
webfocusApp.registerComponent(mailComponent);

let server = webfocusApp.start();
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

try{
    const Tray = require("ctray");
    // Try to start system tray.
    debug("Starting System Tray")
    const menu = [
        { text: "Webfocus ARMS App", disabled: true },
        { 
            text: "Open Webapp",
            callback: () => {
                debug("User opened Application in System Tray")
                open(`http://localhost:${server.address().port}/`)
                tray.update();
            }
        },
        {
            text: "Exit",
            callback: () => {
                debug("User closed application in System Tray.");
                server.close();
                tray.stop();
                process.exit(0);
            }
        }
    ]
    let tray = new Tray(path.join(require("app-data-folder")("arms-app"), 'favicon.ico'), menu);
    tray.start();
    server.once("error", () => tray.stop())
}
catch(e){
    debug("Error System Tray. %O", e)
}

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
                debug("Open Error File");
                open(errorFilePath).finally(() => {
                    process.exit(1);
                })
            })
        }
        else{
            debug("Writing Error File: %s", subError.message);
            process.exit(1);
        }
    }); 
})