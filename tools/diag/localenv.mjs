// Diagnose why a local mirror cannot start the engine.  Logs EVERY console
// message and exception, and serves with correct MIME + no-store.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join, extname} from 'node:path';
const DIST='/Users/cris/Documents/ChatGPT/兰斯4网页化/app/dist';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
 '.wasm':'application/wasm','.json':'application/json','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf',
 '.woff2':'font/woff2','.map':'application/json','.ald':'application/octet-stream','.bin':'application/octet-stream',
 '.ain':'application/octet-stream','.ini':'text/plain; charset=utf-8','.exe':'application/octet-stream','.mp3':'audio/mpeg'};
const PORT=4184;
const hits=[];
const site=createServer(async(req,res)=>{
  let p=join(DIST, decodeURIComponent(new URL(req.url,'http://x').pathname));
  if(p.endsWith('/')) p=join(p,'index.html');
  try{
    const st=await stat(p);
    if(st.isDirectory()) p=join(p,'index.html');
    const buf=await readFile(p);
    hits.push(`${res.statusCode||200} ${req.url} ${buf.length}`);
    res.writeHead(200,{'Content-Type':MIME[extname(p).toLowerCase()]||'application/octet-stream',
      'Content-Length':buf.length,'Cache-Control':'no-store'});
    res.end(buf);
  }catch(e){ hits.push(`404 ${req.url}`); res.writeHead(404).end('nf'); }
}).listen(PORT,'127.0.0.1');

const port=9401;
const chrome=spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
 ['--headless=new',`--remote-debugging-port=${port}`,'--user-data-dir=/tmp/diaglocal-prof','--no-sandbox',
  '--disable-dev-shm-usage','--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
const v=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws=new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0;const pend=new Map();const logs=[];
ws.onmessage=(e)=>{const m=JSON.parse(typeof e.data==='string'?e.data:e.data.toString());
 if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);return;}
 if(m.method==='Runtime.consoleAPICalled'){logs.push('C['+m.params.type+'] '+m.params.args.map(a=>a.value??a.description??a.type).join(' ').slice(0,220));}
 if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;logs.push('EX '+((d.exception&&d.exception.description)||d.text||'').slice(0,300));}
 if(m.method==='Log.entryAdded'){logs.push('L['+m.params.entry.level+'] '+m.params.entry.text.slice(0,220));}
 if(m.method==='Network.loadingFailed'){logs.push('NETFAIL '+m.params.errorText+' '+m.params.type);}};
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method:m,params:p,...(s?{sessionId:s}:{})}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
await send('Network.enable',{},sessionId);await send('Log.enable',{},sessionId).catch(()=>{});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?game=rance4`},sessionId);
await new Promise(r=>setTimeout(r,70000));
const st=await send('Runtime.evaluate',{expression:`JSON.stringify({status:(document.querySelector('#loader .local-status')||{}).textContent,running:typeof Module!=='undefined',canvas:[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height)})`,returnByValue:true},sessionId);
console.log('STATE:', st.result?.value);
console.log('=== console ===');
for(const l of logs.slice(0,35)) console.log(l);
console.log('=== first 25 server hits ===');
for(const h of hits.slice(0,25)) console.log(' ', h);
ws.close();chrome.kill('SIGKILL');site.close();process.exit(0);
