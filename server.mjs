import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';

const siteRoot = resolve('dist');
// Game data lives beside the application checkout (see PUBLIC_DEPLOYMENT.md).
// Override with GAMES_DIR to point at a different location.
const gamesDir = process.env.GAMES_DIR
  ? resolve(process.env.GAMES_DIR)
  : resolve(import.meta.dirname, '..', 'games');
const gameRoots = {
  rance4: join(gamesDir, 'RANCE4'),
  rance41: join(gamesDir, 'RANCE4.1'),
  rance42: join(gamesDir, 'RANCE4.2'),
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

/**
 * Serve a file, honouring a single `bytes=` range.
 *
 * The published site gets its disc image through a Worker that implements
 * Range, and the runtime's remote CD reader *requires* a 206 with a matching
 * Content-Range before it will start.  Without that here, the whole CD audio
 * path -- the suspected cause of the Kichikuou lockup -- could not be exercised
 * locally at all, so a local run would silently prove nothing.
 */
function respondFile(response, path, rangeHeader) {
  fs.stat(path).then((stat) => {
    if (!stat.isFile()) throw new Error('not a file');
    const type = mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };

    const match = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader ?? '').trim());
    if (match && (match[1] || match[2])) {
      const size = stat.size;
      let start;
      let end;
      if (match[1] === '') {
        // Suffix range: the last N bytes.
        const length = Number(match[2]);
        start = Math.max(0, size - length);
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        response.writeHead(416, {'Content-Range': `bytes */${size}`}).end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      createReadStream(path, {start, end}).pipe(response);
      return;
    }

    response.writeHead(200, {...headers, 'Content-Length': stat.size});
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
      if (path) respondFile(response, path, request.headers.range); else response.writeHead(400).end('Invalid path');
    }
    return;
  }
  // Browsers percent-encode non-ASCII resource names. Decode before resolving so
  // the local static server behaves like a production static host.
  const staticPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const path = safePath(siteRoot, normalize(staticPath));
  if (path) respondFile(response, path, request.headers.range); else response.writeHead(400).end('Invalid path');
}).listen(4173, '127.0.0.1', () => console.log('Rance Web: http://127.0.0.1:4173'));
