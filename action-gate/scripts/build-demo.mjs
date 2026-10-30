import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url), output = new URL('demo-dist/', root);
await mkdir(output, { recursive: true });
await cp(new URL('dist/', root), new URL('dist/', output), { recursive: true });
await cp(new URL('demo/', root), new URL('demo/', output), { recursive: true });
const html = await readFile(new URL('demo/index.html', root), 'utf8');
await writeFile(new URL('index.html', output), html.replace('href="./style.css"', 'href="./demo/style.css"').replace('src="./main.js"', 'src="./demo/main.js"'));
console.log('Static demo built: demo-dist/index.html (serve over HTTP)');
