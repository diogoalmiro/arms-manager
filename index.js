process.env.DEBUG = "webfocus:*";

let path = require('path')
let WebfocusApp = require('@webfocus/app');

let configuration = {
    port : 8006, // Specify your port here
    name : "ARMS Manager",
    // Add more configurations here
    views : path.join(__dirname, 'node_modules', '@webfocus', 'app', 'views'),
    static : path.join(__dirname, 'node_modules', '@webfocus', 'app', 'static')
}

let webfocusApp = new WebfocusApp( configuration );

// Register webfocus/app comonents here
// e.g. webfocusApp.registerComponent(require('../component-example'));
webfocusApp.registerComponent(require('@webfocus/util/component'));
webfocusApp.registerComponent(require('./docker'));

webfocusApp.start();
