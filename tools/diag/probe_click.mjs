// Focused test: is the title menu actually driven by mouse input, and does the
// engine see it?  Loads the instrumented build, waits for page 11, then
// dispatches a click on the "Start" button while logging DOM events.
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
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf','.woff2':'font/woff2','.map':'application/json','.ald':'application/octet-stream','.img':'application/octet-stream','.cue':'text/plain','.asd':'application/octet-stream','.ain':'application/octet-stream','.ini':'text/plain','.txt':'text/plain; charset=utf-8'};

async function serveFile(req,res,filePath){
  try{
    const st=await stat(filePath);
    if(st.isDirectory()) return serveFile(req,res,join(filePath,'index.html'));
    const type=MIME[extname(filePath).toLowerCase()]||'application/octet-stream';
    const buf=await readFile(filePath);
    const range=req.headers.range;
    if(range){
      const m=/bytes=(\d*)-(\d*)/.exec(range);
      const start=m[1]?Number(m[1]):0, end=m[2]?Number(m[2]):st.size-1;
      res.writeHead(206,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${st.size}`,'Access-Control-Allow-Origin':'*'});
      return res.end(buf.subarray(start,end+1));
    }
    res.writeHead(200,{'Content-Type':type,'Content-Length':buf.length,'Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    res.end(buf);
  }catch{ res.writeHead(404).end('nf'); }
}

const logStream=createWriteStream(join(OUT,'beacon-click.log'),{flags:'a'});
const site=createServer((req,res)=>{const u=decodeURIComponent(new URL(req.url,'http://x').pathname);const p=join(DIST,u);if(!p.startsWith(DIST))return res.writeHead(403).end();serveFile(req,res,p);}).listen(4173,'127.0.0.1');
const diag=createServer((req,res)=>{if(req.method==='OPTIONS')return res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}).end();let b='';req.on('data',c=>b+=c);req.on('end',()=>{logStream.write(b+'\n');res.writeHead(200,{'Access-Control-Allow-Origin':'*'}).end('ok');});}).listen(4190,'127.0.0.1');

const port=9245;
const brave='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const chrome=spawn(brave,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${join(OUT,'profile-click')}`,'--no-sandbox','--disable-gpu-sandbox','--disable-dev-shm-usage','--disable-crash-reporter','--disable-breakpad','--no-first-run','--disable-gpu','--window-size=1043,612','about:blank'],{stdio:'ignore'});
for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
const v=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws=new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0;const pend=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(typeof e.data==='string'?e.data:e.data.toString());if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const send=(method,params={},sid)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method,params,...(sid?{sessionId:sid}:{})}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
const evalp=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result?.value;};
const shot=async(name)=>{const{data}=await send('Page.captureScreenshot',{format:'png'},sessionId);const p=join(OUT,`click-${name}.png`);await writeFile(p,Buffer.from(data,'base64'));console.log('shot',p);};

await mkdir(OUT,{recursive:true});
await send('Page.navigate',{url:'http://127.0.0.1:4173/index.html?game=rancekingtest&fast=1'},sessionId);

// wait until the engine reports page 11
const t0=Date.now();
let onP11=false;
while(Date.now()-t0<200000){
  await new Promise(r=>setTimeout(r,2000));
  try{
    const t=await evalp('document.title');
    if(typeof t==='string'&&t.startsWith('DIAG|')){
      const m=/p=(\d+)/.exec(t); const f=/f=(\d+)/.exec(t);
      if(m&&Number(m[1])===11){ onP11=true; console.log(`[probe] page 11 at frame ${f&&f[1]} t=${Math.round((Date.now()-t0)/1000)}s`); break; }
    }
  }catch(e){}
}
if(!onP11){console.log('[probe] never reached page 11');}
await shot('title');
// turn message-skip off, then install DOM logging
try{await evalp(`(()=>{const b=document.querySelector('#msgskip-button'); if(b&&b.classList.contains('active')) b.click(); return document.body.className})()`);}catch{}
await evalp(`(()=>{window.__m=[];const c=document.querySelector('#xsystem35 canvas');
  for(const t of ['mousemove','mousedown','mouseup','pointerdown','pointermove','click'])
    c.addEventListener(t,e=>{if(window.__m.length<60)window.__m.push(t+':'+Math.round(e.offsetX)+','+Math.round(e.offsetY)+':trusted='+e.isTrusted+':b='+(e.buttons||0));},true);
  return 'armed';})()`);
const rect=await evalp(`(()=>{const c=document.querySelector('#xsystem35 canvas');const r=c.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
console.log('[probe] canvas rect',JSON.stringify(rect));
const x=rect.x+rect.w*0.585, y=rect.y+rect.h*0.735;
console.log('[probe] clicking start at',x.toFixed(0),y.toFixed(0));
for(const [dx,dy] of [[0,0],[-3,-3],[3,3],[0,0]]){
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'none'},sessionId);
  await new Promise(r=>setTimeout(r,150));
}
await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,buttons:1},sessionId);
await new Promise(r=>setTimeout(r,250));
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,buttons:0},sessionId);
await new Promise(r=>setTimeout(r,2500));
console.log('[probe] DOM events seen:',JSON.stringify(await evalp('window.__m')));
console.log('[probe] title after click:',await evalp('document.title'));
await shot('after-click');
await new Promise(r=>setTimeout(r,6000));
console.log('[probe] title later:',await evalp('document.title'));
await shot('later');
console.log('[probe] DOM events total:',JSON.stringify(await evalp('window.__m')));
ws.close();chrome.kill('SIGKILL');site.close();diag.close();logStream.end();
process.exit(0);
