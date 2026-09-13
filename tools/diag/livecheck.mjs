// Verify the published site: load the real Pages URL, wait for the engine to
// render, and (since this build has no probes) detect progress by comparing
// screenshots.
import {spawn} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'live');
await mkdir(OUT, {recursive: true});
const URL_ = process.argv[2] || 'https://maho37523.github.io/rance4-web/?game=ranceking';
const port = 9262;
const chrome = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(OUT, 'profile')}`,
   '--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--disable-breakpad',
   '--no-first-run', '--disable-gpu', '--window-size=1043,612', 'about:blank'], {stdio: 'ignore'});
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[console] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded') logs.push('[log:' + m.params.entry.level + '] ' + m.params.entry.text); };
const send = (method, params = {}, sid) => new Promise((res, rej) => { const i = ++id; pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params, ...(sid ? {sessionId: sid} : {})})); });
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId).catch(() => {});
const evalp = async (expr) => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true}, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
const shot = async (n) => { const {data} = await send('Page.captureScreenshot', {format: 'png'}, sessionId); const p = join(OUT, n + '.png'); await writeFile(p, Buffer.from(data, 'base64')); console.log('[live] shot', n); };
await send('Page.navigate', {url: URL_}, sessionId);
const t0 = Date.now();
let last = '', shotAt = 0, n = 0, skipped = false, lastClick = 0;
while (Date.now() - t0 < 200000) {
  await new Promise(r => setTimeout(r, 2500));
  const el = Math.round((Date.now() - t0) / 1000);
  try {
    const st = await evalp(`JSON.stringify({status:(document.querySelector('#loader .local-status')||{}).textContent||'', canvases:[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height)})`);
    if (st !== last) { last = st; console.log(`[live] t=${el}s ${st}`); }
  } catch (e) { console.log(`[live] t=${el}s eval blocked: ${e.message}`); }
  if (!skipped && el > 25) { skipped = true; try { await evalp('Module._msgskip_activate(1)'); console.log('[live] message skip on'); } catch {} }
  if (el > 30 && Date.now() - lastClick > 6000) {
    lastClick = Date.now();
    try {
      const rc = await evalp(`(()=>{const c=document.querySelector('#xsystem35 canvas');if(!c)return null;const r=c.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
      if (rc) {
        const x = rc.x + rc.w * 0.585, y = rc.y + rc.h * 0.735;
        await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y, button: 'none'}, sessionId);
        await new Promise(r => setTimeout(r, 120));
        await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1}, sessionId);
        await new Promise(r => setTimeout(r, 120));
        await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0}, sessionId);
      }
    } catch {}
  }
  if (el > 45 && Date.now() - shotAt > 15000 && n < 10) { shotAt = Date.now(); await shot('t' + el); n++; }
}
await shot('final');
for (const l of logs.slice(-25)) console.log(l);
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
