// Load a given SA.ALD in the trusted local environment and report engine state.
import {createServer} from 'node:http';
import {readFile, stat, copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join, extname} from 'node:path';
const DIST='/Users/cris/Documents/ChatGPT/兰斯4网页化/app/dist';
const SA=join(DIST,'games/rance4/RANCE4SA.ALD');
const variant=process.argv[2];
const PORT=4185, CDP=9403+ (Number(process.argv[3])||0);
await copyFile(variant, SA);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
 '.json':'application/json','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf','.woff2':'font/woff2',
 '.map':'application/json','.ald':'application/octet-stream','.bin':'application/octet-stream','.ain':'application/octet-stream',
 '.ini':'text/plain; charset=utf-8','.exe':'application/octet-stream','.mp3':'audio/mpeg','':''};
const site=createServer(async(req,res)=>{
  let p=join(DIST, decodeURIComponent(new URL(req.url,'http://x').pathname));
  if(p.endsWith('/')) p=join(p,'index.html');
  try{ const st=await stat(p); if(st.isDirectory()) p=join(p,'index.html');
    const buf=await readFile(p);
    res.writeHead(200,{'Content-Type':MIME[extname(p).toLowerCase()]||'application/octet-stream','Content-Length':buf.length,'Cache-Control':'no-store'});
    res.end(buf);
  }catch(e){ res.writeHead(404).end('nf'); }
}).listen(PORT,'127.0.0.1');
const chrome=spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
 ['--headless=new',`--remote-debugging-port=${CDP}`,'--user-data-dir=/tmp/enginetest-prof','--no-sandbox',
  '--disable-dev-shm-usage','--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
let up=false;
for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${CDP}/json/version`);if(r.ok){up=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
if(!up){console.log('RESULT: chrome failed'); process.exit(2);}
const v=await(await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
const ws=new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0;const pend=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(typeof e.data==='string'?e.data:e.data.toString());
 if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method:m,params:p,...(s?{sessionId:s}:{})}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?game=rance4`},sessionId);
let result='no-canvas';
for (let t=0;t<18;t++){
  await new Promise(r=>setTimeout(r,5000));
  let st;
  try{ st=await Promise.race([
      send('Runtime.evaluate',{expression:`[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height).join(',')`,returnByValue:true},sessionId),
      new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),4000))
    ]); }catch(e){ console.log('RESULT: HANG (page unresponsive) at t='+(t*5)+'s'); ws.close();chrome.kill('SIGKILL');site.close();process.exit(1); }
  const val=st.result?.value||'';
  if(val.includes('640x480')){ result='640x480 at t='+(t*5)+'s'; break; }
}
console.log('RESULT: '+result);
ws.close();chrome.kill('SIGKILL');site.close();process.exit(0);
