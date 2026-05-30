/**
 * Smoke test for coupon ZIP packaging (archiver v8 ZipArchive + optional zip CLI).
 * Run: node scripts/test-coupon-zip.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createWriteStream } from 'fs';
import { ZipArchive } from 'archiver';

const execFileAsync = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coupon-zip-test-'));
const pdfPath = path.join(tmp, 'sample.pdf');
fs.writeFileSync(pdfPath, '%PDF-1.4 test');

async function zipWithCli(out) {
  await execFileAsync('zip', ['-j', '-q', out, pdfPath]);
}

async function zipWithArchiver(out) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(out);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(pdfPath, { name: 'sample.pdf' });
    void archive.finalize().catch(reject);
  });
}

const cliZip = path.join(tmp, 'cli.zip');
const archiverZip = path.join(tmp, 'archiver.zip');

await zipWithArchiver(archiverZip);
const archiverSize = fs.statSync(archiverZip).size;
if (archiverSize < 10) throw new Error('ZipArchive produced empty zip');

try {
  await zipWithCli(cliZip);
  console.log('CLI zip OK', fs.statSync(cliZip).size, 'bytes');
} catch {
  console.log('CLI zip skipped (zip not installed)');
}

console.log('ZipArchive OK', archiverSize, 'bytes');
fs.rmSync(tmp, { recursive: true, force: true });
