import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 5188);
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/demo/index.html' : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || pathname.includes('/.') || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
    if (!(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Action Gate demo: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
