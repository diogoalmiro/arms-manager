const path = require('path')
const Tray = require("ctray");
const open = require("open");
const debug = require("debug")("webfocus:main")

const menu = [
    { text: "Webfocus ARMS App", disabled: true },
    { text: "Open Webapp", disabled: true },
    { text: "Exit", disabled: true }
]

let tray = new Tray(path.join(process.env.APPDATA, 'arms-app/favicon.ico'), menu)

debug("Starting System Tray")
tray.start();

let WebfocusApp = require('@webfocus/app');

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
webfocusApp.registerComponent(require('@webfocus/util/component'));
webfocusApp.registerComponent(require('./docker'));

let server = webfocusApp.start();

menu[1].disabled = false;
menu[1].callback = () => {
    debug("User opened Application in System Tray")
    open(`http://localhost:${server.address().port}/`)
    tray.update();
};
menu[2].disabled = false;
menu[2].callback = () => {
    debug("User closed application in System Tray.");
    server.close();
    tray.stop();
    process.exit(0);
}
tray.menu = menu;
debug("Updating System Tray")
tray.update();



/*
 

smtp=mx7.un.org
client.Port = 25;

mail.From = new MailAddress(arms@un.org);

let nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
    host: "mx7.un.org",
    port: 25
})

transporter.verify((err, succ) => {
    console.log(err, succ)
})
*/