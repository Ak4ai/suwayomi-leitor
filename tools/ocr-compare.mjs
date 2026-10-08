import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const envFile = fileURLToPath(new URL('.env.ocr', root));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const python = fileURLToPath(new URL(process.platform === 'win32' ? '.venv-ocr/Scripts/python.exe' : '.venv-ocr/bin/python', root));
if (!existsSync(python)) {
    console.error('Prepare o ambiente conforme OCR-COMPARISON.md antes de executar.');
    process.exitCode = 1;
} else {
    const child = spawn(python, ['tools/ocr_compare/server.py'], { cwd: fileURLToPath(root), stdio: 'inherit' });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
    child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    process.on('SIGINT', () => child.kill('SIGINT'));
}
