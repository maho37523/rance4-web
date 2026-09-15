// Local test harness for the instrumented xsystem35 build.
//
//   * serves dist/ on 4173
//   * collects engine diagnostic beacons on 4190 into .diag-archive/round9/run/
//   * drives Brave over CDP (Node's built-in WebSocket): load, wait, screenshot
//
// usage: node round9/harness.mjs [--wait-ms N] [--shot prefix] [--url url] [--keep-open]
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP = resolve(__dirname, '..', '..');
const DIST = join(APP, 'dist');
const OUT = join(__dirname, 'run');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.map': 'application/json', '.ald': 'application/octet-stream',
  '.img': 'application/octet-stream', '.cue': 'text/plain', '.asd': 'application/octet-stream',
  '.ain': 'application/octet-stream', '.ini': 'text/plain', '.txt': 'text/plain; charset=utf-8',
  '.bat': 'text/plain', '.otf': 'font/otf',
};

async function serveFile(req, res, filePath) {
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) return serveFile(req, res, join(filePath, 'index.html'));
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    const buf = await readFile(filePath);
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : st.size - 1;
      const len = end - start + 1;
      res.writeHead(206, {
        'Content-Type': type, 'Content-Length': len, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('not found: ' + filePath);
  }
}

function startServers(logStream) {
  const site = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = join(DIST, url);
    if (!p.startsWith(DIST)) return res.writeHead(403).end();
    serveFile(req, res, p);
  }).listen(4173, '127.0.0.1');

  const diag = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      return res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }).end();
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      logStream.write(body + '\n');
      res.writeHead(200, {'Access-Control-Allow-Origin': '*'}).end('ok');
    });
  }).listen(4190, '127.0.0.1');
  return {site, diag};
}

function connectWs(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error('websocket error'));
  });
}

async function main() {
  await mkdir(OUT, {recursive: true});
  const args = process.argv.slice(2);
  const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const waitMs = Number(getArg('--wait-ms', '90000'));
  const shotPrefix = getArg('--shot', 'run');
  const keepOpen = args.includes('--keep-open');
  const url = getArg('--url', 'http://127.0.0.1:4173/index.html?game=rancekingtest');
  const port = Number(getArg('--port', '9233'));
  const profileArg = getArg('--profile', '');

  const logPath = join(OUT, `beacon-${shotPrefix}.log`);
  const logStream = createWriteStream(logPath, {flags: 'a'});
  const {site, diag} = startServers(logStream);
  console.log('[harness] site  http://127.0.0.1:4173');
  console.log('[harness] diag  http://127.0.0.1:4190');
  console.log('[harness] beacons ->', logPath);

  const profile = profileArg || join(OUT, `profile-${shotPrefix}`);
  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const chrome = spawn(brave, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
    '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--use-gl=swiftshader',
    '--disable-software-rasterizer', '--in-process-gpu',
    '--autoplay-policy=no-user-gesture-required',
    ...(process.env.PROXY_SERVER ? [`--proxy-server=${process.env.PROXY_SERVER}`] : []),
    '--window-size=1043,612',
    'about:blank',
  ], {stdio: ['ignore', 'pipe', 'pipe']});
  chrome.stdout.on('data', (d) => process.stdout.write('[brave] ' + d));
  chrome.stderr.on('data', (d) => {
    const s = d.toString();
    if (/DevTools listening|ERROR|FATAL|Failed/.test(s)) process.stdout.write('[brave] ' + s);
  });

  let ok = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { ok = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ok) { console.error('[harness] devtools did not come up'); process.exit(1); }
  console.log('[harness] devtools up');

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = await connectWs(version.webSocketDebuggerUrl);

  let msgId = 0;
  const pending = new Map();
  const consoleMsgs = [];
  let sessionId;
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const {resolve: res, reject: rej} = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push('[console] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Log.entryAdded') {
      consoleMsgs.push('[log:' + m.params.entry.level + '] ' + m.params.entry.text);
    }
  };
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, {resolve: res, reject: rej});
    ws.send(JSON.stringify({id, method, params, ...(sid ? {sessionId: sid} : {})}));
  });

  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  ({sessionId} = await send('Target.attachToTarget', {targetId, flatten: true}));
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId).catch(() => {});

  const evaluateInPage = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true}, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot = async (name) => {
    const {data} = await send('Page.captureScreenshot', {format: 'png'}, sessionId);
    const p = join(OUT, `${shotPrefix}-${name}.png`);
    await writeFile(p, Buffer.from(data, 'base64'));
    console.log('[harness] screenshot', p.split('/').pop());
    return p;
  };

  console.log('[harness] navigate', url);
  await send('Page.navigate', {url}, sessionId);

  // ---- input drivers (mobile controls listen on #xsystem35 canvas) ----
  const canvasRect = async () => evaluateInPage(`(() => {
    const c = document.querySelector('#xsystem35 canvas') || document.querySelector('canvas');
    if (!c) return null; const r = c.getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height};
  })()`);
  const keys = {
    Enter: {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r'},
    Escape: {key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27},
    z: {key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, text: 'z'},
    x: {key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88, text: 'x'},
    ArrowDown: {key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40},
    ArrowUp: {key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38},
  };
  const pressKey = async (name, holdMs = 60) => {
    const k = keys[name] || keys.Enter;
    await send('Input.dispatchKeyEvent', {type: 'keyDown', ...k}, sessionId);
    await new Promise((r) => setTimeout(r, holdMs));
    await send('Input.dispatchKeyEvent', {type: 'keyUp', ...k}, sessionId);
  };
  const clickAt = async (fx, fy) => {
    const rc = await canvasRect();
    if (!rc) { console.log('[harness] no canvas to click'); return; }
    const x = rc.x + rc.w * fx, y = rc.y + rc.h * fy;
    // The engine polls the pointer, so move first, then press and release.
    await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y, button: 'none'}, sessionId);
    await new Promise((r) => setTimeout(r, 120));
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1}, sessionId);
    await new Promise((r) => setTimeout(r, 120));
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0}, sessionId);
    console.log(`[harness] click at ${x.toFixed(0)},${y.toFixed(0)}`);
  };

  // Timed actions: --actions "3000:click:0.58:0.74,6000:key:Enter"
  const actions = [];
  const actionsArg = getArg('--actions', '');
  if (actionsArg) {
    for (const spec of actionsArg.split(',')) {
      if (!spec.trim()) continue;
      const parts = spec.trim().split(':');
      actions.push({at: Number(parts[0]) * 1000, kind: parts[1], a: parts[2], b: parts[3]});
    }
  }
  let actionIdx = 0;

  const t0 = Date.now();
  const marks = [0.15, 0.4, 0.7, 1.0];
  let mi = 0, shotIdx = 0;
  let lastAutoAct = 0;
  const autoAct = args.includes('--auto-advance');
  while (Date.now() - t0 < waitMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const elapsed = Date.now() - t0;
    const frac = elapsed / waitMs;
    while (actionIdx < actions.length && elapsed >= actions[actionIdx].at) {
      const act = actions[actionIdx++];
      if (act.kind === 'click') await clickAt(Number(act.a), Number(act.b));
      else if (act.kind === 'key') await pressKey(act.a, 60);
      else if (act.kind === 'shot') await shot(act.a || `act${actionIdx}`);
      else if (act.kind === 'noskip') {
        try { await evaluateInPage('(()=>{const b=document.querySelector("#msgskip-button"); if(b) b.click();})()'); } catch {}
        console.log('[harness] message-skip toggled off');
      }
    }
    if (autoAct && elapsed - lastAutoAct > 900) {
      lastAutoAct = elapsed;
      await pressKey('Enter', 40);
    }
    if (mi < marks.length && frac >= marks[mi]) {
      mi++;
      await shot(String(shotIdx++).padStart(2, '0'));
      try {
        const s = await evaluateInPage(`JSON.stringify({title:document.title,
          status:(document.querySelector('#loader .local-status')||{}).textContent,
          canvases:[...document.querySelectorAll('canvas')].map(c=>c.id+':'+c.width+'x'+c.height+(c.hidden?':hidden':'')),
          diag:self.__nactDiag||null})`);
        console.log(`[harness] t=${Math.round(elapsed / 1000)}s ${s}`);
      } catch (e) { console.log('[harness] eval failed:', e.message); }
    }
  }
  await shot(String(shotIdx++).padStart(2, '0'));

  for (const m of consoleMsgs.slice(-60)) console.log(m);

  if (!keepOpen) {
    ws.close();
    chrome.kill('SIGKILL');
    site.close(); diag.close();
    logStream.end();
  } else {
    console.log('[harness] keeping brave open; pid', chrome.pid);
  }
  console.log('[harness] done');
  if (!keepOpen) process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
