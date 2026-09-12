import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';

const siteRoot = resolve('dist');
const gameRoots = {
  rance4: '/Users/cris/Documents/games/RANCE4',
  rance41: '/Users/cris/Documents/games/RANCE4.1',
  rance42: '/Users/cris/Documents/games/RANCE4.2',
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.otf': 'font/otf', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

function safePath(root, pathname) {
  const target = resolve(root, pathname);
  return relative(root, target).startsWith('..') ? undefined : target;
}

async function listFiles(root, directory = '') {
  const entries = await fs.readdir(join(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function respondFile(response, path) {
  fs.stat(path).then((stat) => {
    if (!stat.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(path).pipe(response);
  }).catch(() => {
    response.writeHead(404).end('Not found');
  });
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const gameMatch = /^\/api\/games\/(rance4|rance41|rance42)(?:\/files\/(.*))?$/.exec(url.pathname);
  if (gameMatch) {
    const root = gameRoots[gameMatch[1]];
    if (!gameMatch[2]) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      const files = await listFiles(root);
      // System 3 games may bundle a separate hint disk with a second ADISK.DAT.
      // The web runtime must receive only the main game root plus its BGM tracks.
      response.end(JSON.stringify({ files: files.filter((path) => !path.includes('/') || path.toLowerCase().startsWith('bgm/')) }));
    } else {
      const path = safePath(root, decodeURIComponent(gameMatch[2]));
      if (path) respondFile(response, path); else response.writeHead(400).end('Invalid path');
    }
    return;
  }
  // Browsers percent-encode non-ASCII resource names. Decode before resolving so
  // the local static server behaves like a production static host.
  const staticPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const path = safePath(siteRoot, normalize(staticPath));
  if (path) respondFile(response, path); else response.writeHead(400).end('Invalid path');
}).listen(4173, '127.0.0.1', () => console.log('Rance Web: http://127.0.0.1:4173'));
