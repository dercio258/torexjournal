import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const testsDir = path.join(clientRoot, 'tests');
const tmpDir = path.join(clientRoot, '.tmp-unit-tests');

async function main() {
    const testFiles = fs
        .readdirSync(testsDir)
        .filter((f) => f.endsWith('.spec.ts'))
        .map((f) => path.join(testsDir, f));

    if (testFiles.length === 0) {
        console.log('No frontend unit test files found.');
        return;
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        const outFiles = [];
        for (const entry of testFiles) {
            const outFile = path.join(
                tmpDir,
                path.basename(entry).replace(/\.spec\.ts$/, '.spec.mjs')
            );
            await build({
                entryPoints: [entry],
                outfile: outFile,
                bundle: true,
                platform: 'node',
                format: 'esm',
                packages: 'external',
                target: 'node20',
                sourcemap: 'inline',
            });
            outFiles.push(outFile);
        }

        execFileSync(process.execPath, ['--test', ...outFiles], {
            cwd: clientRoot,
            stdio: 'inherit',
        });
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
