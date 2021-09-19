const path = require('path')
const open = require("open");
const debug = require("debug")("webfocus:main")
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
}
catch(e){
    debug("Error System Tray. %O", e)
}