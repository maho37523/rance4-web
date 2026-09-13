// Check whether CDP-dispatched mouse events reach the emscripten canvas and
// whether the shell/engine see them.
import {spawn} from 'node:child_process';
const port = 9244;
const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const chrome = spawn(brave, ['--headless=new', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/mouse-probe-profile', '--no-sandbox', '--disable-gpu-sandbox',
  '--disable-dev-shm-usage', '--no-first-run', '--disable-crash-reporter', '--disable-breakpad',
  '--window-size=1043,612', 'about:blank'], {stdio: 'ignore'});
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,400)); }
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pend=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(typeof e.data==="string"?e.data:e.data.toString()); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const send=(method,params={},sid)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method,params,...(sid?{sessionId:sid}:{})}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId); await send('Runtime.enable',{},sessionId);
const evalp=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true},sessionId); if(r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value;};
await send('Page.navigate',{url:'data:text/html,<html><body style="margin:0"><canvas id="c" width="640" height="400" style="width:320px;height:200px;background:%23345"></canvas></body></html>'},sessionId);
await new Promise(r=>setTimeout(r,600));
await evalp(`window.__ev=[]; for (const t of ['mousemove','mousedown','mouseup']) document.addEventListener(t, e=>{window.__ev.push(t+':'+e.clientX+','+e.clientY+':trusted='+e.isTrusted)}, true); 'ok'`);
const rect = await evalp(`(()=>{const c=document.getElementById('c');const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
console.log('canvas rect', JSON.stringify(rect));
const x=rect.x+rect.w*0.5, y=rect.y+rect.h*0.5;
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none'},sessionId);
await new Promise(r=>setTimeout(r,100));
await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,buttons:1},sessionId);
await new Promise(r=>setTimeout(r,100));
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,buttons:0},sessionId);
await new Promise(r=>setTimeout(r,200));
console.log('events seen:', JSON.stringify(await evalp('window.__ev')));
console.log('elementFromPoint:', await evalp(`(()=>{const e=document.elementFromPoint(${x},${y});return e? e.tagName+'#'+e.id : 'none'})()`));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
