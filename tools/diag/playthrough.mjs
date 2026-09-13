// Playthrough driver: loads the game, watches the engine's page-entry beacons,
// and clicks "Start" only once the title menu (page 11) is actually up.
// Relies on the instrumented build that POSTs PAGE/BADJMP to :4190.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP = resolve(__dirname, '..', '..');
const DIST = join(APP, 'dist');
const OUT = join(__dirname, 'play');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf','.woff2':'font/woff2','.map':'application/json','.ald':'application/octet-stream','.img':'application/octet-stream','.cue':'text/plain','.asd':'application/octet-stream','.ain':'application/octet-stream','.ini':'text/plain','.txt':'text/plain; charset=utf-8'};

async function serveFile(req, res, p) {
  try {
    const st = await stat(p);
    if (st.isDirectory()) return serveFile(req, res, join(p, 'index.html'));
    const type = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
    const buf = await readFile(p);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const s = m[1] ? Number(m[1]) : 0, e = m[2] ? Number(m[2]) : st.size - 1;
      res.writeHead(206, {'Content-Type': type, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Access-Control-Allow-Origin': '*'});
      return res.end(buf.subarray(s, e + 1));
    }
    res.writeHead(200, {'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'});
    res.end(buf);
  } catch { res.writeHead(404).end('nf'); }
}

await mkdir(OUT, {recursive: true});
const beaconPath = join(OUT, 'beacons.log');
const beaconStream = createWriteStream(beaconPath, {flags: 'a'});
const pages = [];
const badjumps = [];
const site = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = join(DIST, u);
  if (!p.startsWith(DIST)) return res.writeHead(403).end();
  serveFile(req, res, p);
}).listen(4173, '127.0.0.1');
const diag = createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}).end();
  let b = '';
  req.on('data', (c) => b += c);
  req.on('end', () => {
    beaconStream.write(b + '\n');
    for (const line of b.split('\n')) {
      const m = /^PAGE page=(\d+) index=(\d+) size=(\d+)/.exec(line.trim());
      if (m) { pages.push({page: +m[1], index: +m[2], size: +m[3], t: Date.now()}); }
      const j = /^BADJMP page=(\d+) from=(\d+) to=(\d+) size=(\d+)/.exec(line.trim());
      if (j) { badjumps.push({page: +j[1], from: +j[2], to: +j[3], size: +j[4]}); }
    }
    res.writeHead(200, {'Access-Control-Allow-Origin': '*'}).end('ok');
  });
}).listen(4190, '127.0.0.1');

const port = 9251;
const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const chrome = spawn(brave, ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(OUT, 'profile')}`, '--no-sandbox', '--disable-gpu-sandbox',
  '--disable-dev-shm-usage', '--disable-crash-reporter', '--disable-breakpad',
  '--no-first-run', '--disable-gpu', '--window-size=1043,612', 'about:blank'], {stdio: 'ignore'});
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (method, params = {}, sid) => new Promise((res, rej) => { const i = ++id; pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params, ...(sid ? {sessionId: sid} : {})})); });
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
const evalp = async (expr) => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true}, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const {data} = await send('Page.captureScreenshot', {format: 'png'}, sessionId); const p = join(OUT, `${name}.png`); await writeFile(p, Buffer.from(data, 'base64')); console.log('[play] shot', name); };

await send('Page.navigate', {url: 'http://127.0.0.1:4173/index.html?game=rkt'}, sessionId);

const t0 = Date.now();
const seen = new Set();
let shots = 0, lastClick = 0, autoSkipped = false;
while (Date.now() - t0 < 480000) {
  await new Promise(r => setTimeout(r, 2000));
  const el = Math.round((Date.now() - t0) / 1000);
  const cur = pages[pages.length - 1];
  if (cur && !seen.has(cur.page)) {
    seen.add(cur.page);
    console.log(`[play] t=${el}s entered page ${cur.page} (size ${cur.size})`);
  }
  // Let the boot sequence settle, then turn on message skipping so cutscenes
  // advance, and click the play area periodically (covers the title menu).
  if (!autoSkipped && el > 12) {
    autoSkipped = true;
    try { await evalp('Module._msgskip_activate(1)'); console.log('[play] message skip on'); } catch (e) { console.log('[play] skip failed', e.message); }
  }
  if (el > 25 && Date.now() - lastClick > 5000) {
    lastClick = Date.now();
    const rc = await evalp(`(()=>{const c=document.querySelector('#xsystem35 canvas');if(!c)return null;const r=c.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    if (rc) {
      const x = rc.x + rc.w * 0.585, y = rc.y + rc.h * 0.735;
      await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y, button: 'none'}, sessionId);
      await new Promise(r => setTimeout(r, 150));
      await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1}, sessionId);
      await new Promise(r => setTimeout(r, 150));
      await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0}, sessionId);
    }
    if (el > 60 && shots < 8) { shots++; await shot('t' + el); }
  }
}
await shot('final');
console.log('\n[play] pages entered:', [...seen].sort((a, b) => a - b).join(','));
console.log('[play] BADJMP count:', badjumps.length, badjumps.slice(0, 5));
const p69 = pages.filter(p => p.page === 69);
console.log('[play] page-69 entries:', p69.length, p69.slice(0, 3));
console.log('[play] max page:', Math.max(...pages.map(p => p.page), 0));
ws.close(); chrome.kill('SIGKILL'); site.close(); diag.close(); beaconStream.end();
process.exit(0);
