const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'backend-nest', 'dist', 'main.js');

if (!fs.existsSync(mainPath)) {
    console.error('❌ Error: The NestJS backend is not built.');
    console.error('Please run "npm run build" in the "backend-nest" directory before starting the server.');
    process.exit(1);
}

console.log('🚀 Bootstrapping NestJS Backend from root server.js...');
require(mainPath);