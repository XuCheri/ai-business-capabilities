import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
await mkdir('demo-dist', { recursive: true });
await cp('dist', 'demo-dist/dist', { recursive: true });
await cp('demo', 'demo-dist/demo', { recursive: true });
let html = await readFile('demo/index.html', 'utf8');
html = html.replace('./style.css', './demo/style.css').replace('./main.js', './demo/main.js');
await writeFile('demo-dist/index.html', html);
console.log('静态演示已生成 demo-dist/；使用 HTTP 静态服务打开 index.html。');
