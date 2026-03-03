
// Wrapper script to generate proto files
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const run = (cmd, cwd) => {
    console.log(`Running: ${cmd} in ${cwd}`);
    exec(cmd, { cwd }, (err, stdout, stderr) => {
        if (err) {
            console.error(`Error: ${err.message}`);
            return;
        }
        if (stderr) console.error(`Stderr: ${stderr}`);
        console.log(`Stdout: ${stdout}`);
    });
};

const backendCwd = 'e:\\TRADING COSSA\\backend-nest';
const clientCwd = 'e:\\TRADING COSSA\\client';

// Ensure output dirs exist
if (!fs.existsSync(path.join(backendCwd, 'src', 'proto'))) fs.mkdirSync(path.join(backendCwd, 'src', 'proto'));
if (!fs.existsSync(path.join(clientCwd, 'src', 'proto'))) fs.mkdirSync(path.join(clientCwd, 'src', 'proto'));

// Backend Generation (CommonJS)
run('npx pbjs -t static-module -w commonjs -o src/proto/browser_packet.js proto/browser_packet.proto && npx pbts -o src/proto/browser_packet.d.ts src/proto/browser_packet.js', backendCwd);

// Client Generation (ES6 for Vite)
run('npx pbjs -t static-module -w es6 -o src/proto/browser_packet.js ../backend-nest/proto/browser_packet.proto && npx pbts -o src/proto/browser_packet.d.ts src/proto/browser_packet.js', clientCwd);
