import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 5177);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/demo/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`证据审阅台：http://127.0.0.1:${port}/demo/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
