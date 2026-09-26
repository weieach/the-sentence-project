import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const assets = {};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, prefix + '/' + entry.name);
    else if (entry.isFile() && types[extname(entry.name)]) assets[prefix + '/' + entry.name] = { type: types[extname(entry.name)], body: (await readFile(path)).toString('base64') };
    else throw new Error('Unexpected public asset: ' + path);
  }
}
await collect('public');
const parts = [];
for (const file of ['config.js', 'validation.js', 'storage.js', 'worker.js']) {
  let source = await readFile('server/' + file, 'utf8');
  source = source.replace(/^import .*;\n/gm, '');
  if (file === 'worker.js') source = source.replace('const bundledAssets = {};', 'const bundledAssets = ' + JSON.stringify(assets) + ';');
  parts.push(source);
}
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', parts.join('\n'));
const result = await import(new URL('../dist/server/index.js', import.meta.url));
if (typeof result.default?.fetch !== 'function') throw new Error('Missing Worker fetch entrypoint.');
console.log(`Built Worker with ${Object.keys(assets).length} public assets. No environment files are included.`);
