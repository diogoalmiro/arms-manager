const fs = require("fs")
const path = require("path")
const Status = {
    READY: "Ready",
    QUEUED: "Queued",
    ERROR: "Error",
    FINNISHED: "Finnished",
    RUNNING : "Running",
    PAUSED: "Paused"
}

module.exports = class Settings{
    constructor(task, input, output, comp=true, prep=false, lang=['eng'], priority=1){
        this.task = task,
        this.input = input;
        this.output = output;
        this.comp = comp;
        this.prep = prep;
        this.lang = lang;
        this.userPaused = false;
        this.priority = priority;
        this.uploaded = new Date();
    }

    static create(taskName, input, output, obj=null){
        let settings = obj || new Settings(taskName, input, output);
        fs.writeFileSync(path.join(Settings.basedir, taskName), JSON.stringify(settings))
        return settings;
    }
    static read(taskName){
        try{
            return JSON.parse(fs.readFileSync(path.join(Settings.basedir, taskName)));
        }
        catch(e){
            console.log(e)
            return null;
        }
    }
    static update(taskName, settings){
        Settings.create(taskName, settings.input, settings.output, settings);
    }
    static delete(taskName){
        fs.rmSync(path.join(Settings.basedir, taskName))
    }

    static get STATUS(){
        return Status;
    }

    static get basedir(){
        return Settings._basedir;
    }
    static set basedir(value){
        return Settings._basedir = value;
    }
    
}