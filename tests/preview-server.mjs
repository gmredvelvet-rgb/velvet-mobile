// Local component fixture. Optional second argument: Foundry's public folder.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const foundryRoot = process.argv[3] && resolve(process.argv[3]);
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const external = url.pathname.startsWith('/foundry/');
    const base = external ? foundryRoot : resolve(root);
    if (!base) { res.writeHead(404).end(); return; }
    const path = resolve(base, '.' + decodeURIComponent(external ? url.pathname.slice(8) : url.pathname));
    if (!path.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
server.listen(Number(process.argv[2] ?? 30147), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/tests/ui-preview.html`));
