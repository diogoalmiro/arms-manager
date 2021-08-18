let fs = require('fs');
let path = require('path');

const  IMAGE_NAME = module.exports = "arms-automatic-docker-image";
const DOCKER_IMAGE_FOLDER = path.join(process.env.APPDATA, "arms-app-docker");

fs.mkdirSync(DOCKER_IMAGE_FOLDER, { recursive: true });

fs.writeFileSync(path.join(DOCKER_IMAGE_FOLDER, 'Dockerfile'), fs.readFileSync(path.join(__dirname, 'Dockerfile')));
console.error("Building/Updating docker image...")
require('child_process').execSync(`docker build -t ${IMAGE_NAME} .`, {
    cwd: DOCKER_IMAGE_FOLDER
});
