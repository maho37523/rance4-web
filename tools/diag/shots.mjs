#!/usr/bin/env node
/**
 * Screenshot one local game URL and dump the shell's own diagnostic report.
 *
 * This is the counterpart to `harness.mjs`: that one drives the instrumented
 * engine through beacons, this one reads the flight recorder the shell ships
 * with, which is the only channel a phone has.  It is used to compare two
 * launches of the same scene (for example `?cjkfont=0` against the default)
 * and to keep a copy of exactly what the engine was told to do.
 *
 *   node tools/diag/shots.mjs --shot before --url "http://127.0.0.1:4173/index.html?game=rance4"
 *   node tools/diag/shots.mjs --shot after  --url "...&cjkfont=0" --width 812 --height 375 --touch
 *
 * Results land in tools/diag/run/ (gitignored): <shot>-t<seconds>.png and
 * <shot>-diag.txt.
 */
import {createServer} from 'node:http';
import {readFile, stat, writeFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {extname, join, resolve} from 'node:path';

const APP = resolve(import.meta.dirname, '..', '..');
const DIST = join(APP, 'dist');
const OUT = join(APP, 'tools', 'diag', 'run');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json',
    '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
    '.map': 'application/json', '.mp3': 'audio/mpeg', '.ini': 'text/plain; charset=utf-8',
};

function arg(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const shot = arg('shot', 'shot');
const url = arg('url', 'http://127.0.0.1:4173/index.html?game=rance4&fast=1');
const waitMs = Number(arg('wait-ms', '90000'));
const sampleAt = Number(arg('sample-at', '60000'));
const width = Number(arg('width', '1043'));
const height = Number(arg('height', '531'));
const PORT = 4191;
const CDP = 9411;

await mkdir(OUT, {recursive: true});

const site = createServer(async (req, res) => {
    let path = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/'))
        path = join(path, 'index.html');
    try {
        const info = await stat(path);
        if (info.isDirectory())
            path = join(path, 'index.html');
        const body = await readFile(path);
        res.writeHead(200, {
            'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(PORT, "127.0.0.1", () => console.log(`[shots] site http://127.0.0.1:${PORT}`));

const profile = `/tmp/shots-${shot}-${Date.now()}`;
const chrome = spawn(BRAVE, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
], {stdio: 'ignore'});

let ready = false;
for (let i = 0; i < 60; i++) {
    try {
        if ((await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok) { ready = true; break; }
    } catch { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
    console.log('RESULT: devtools did not come up');
    chrome.kill('SIGKILL');
    site.close();
    process.exit(2);
}

const version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
};
// Every CDP call is bounded.  An unbounded await once made this script sit on a
// single `Input.dispatchMouseEvent` for ten minutes and look exactly like the
// game hanging, which is a expensive way to be wrong.
const send = (method, params = {}, sessionId, timeoutMs = 20000) => new Promise((res, rej) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
        resolve: (v) => { clearTimeout(timer); res(v); },
        reject: (e) => { clearTimeout(timer); rej(e); },
    });
    ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
});

const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: hasFlag('touch'),
}, sessionId);
if (hasFlag('touch')) {
    // Deliberately no setEmitTouchEventsForMouse: with it on, a synthesised
    // Input.dispatchMouseEvent is never acknowledged, which stalls the caller
    // forever.  Touch emulation alone is enough to make the page behave like a
    // phone, and CDP mouse events still hit-test the same elements.
    await send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5}, sessionId);
    // The launcher decides at gamestart whether to enable touch controls by
    // asking matchMedia('(pointer: coarse)'); headless Chrome answers "fine"
    // even with touch emulation on, so answer it the way a phone would.
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
            const original = window.matchMedia.bind(window);
            window.matchMedia = (query) => {
                if (query.includes('pointer: coarse'))
                    return {matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null};
                return original(query);
            };
            Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5});
        })();`,
    }, sessionId);
    console.log('[shots] forcing coarse pointer');
}
await send('Page.navigate', {url}, sessionId);

const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId);
    return result.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
let captured = false;
let report = '';
let state = '';

// `--click t:x,y;t:x,y` presses and releases screen points, `t` in seconds
// after load.  It is how the phone layout is verified: the collapsed toolbar
// has to be openable and the in-game 攻略/修改器 buttons have to be
// hit-testable there, which a screenshot alone cannot show.
const clicks = (arg('click', '') ? arg('click', '').split(';') : []).map((entry) => {
    const [at, x, y] = entry.split(':');
    return {at: Number(at), x: Number(x), y: Number(y)};
}).filter((entry) => Number.isFinite(entry.at) && Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((a, b) => a.at - b.at);
const clicked = new Set();
if (clicks.length)
    console.log(`[shots] scheduled clicks: ${clicks.map((c) => `${c.at}s@${c.x},${c.y}`).join(' ')}`);

async function updateState() {
    state = await evaluate(`JSON.stringify({
        title: document.title,
        status: document.querySelector('#loader .local-status')?.textContent || '',
        canvas: (() => { const c = document.querySelector('#canvas');
            if (!c) return null; const r = c.getBoundingClientRect();
            return {internal: c.width + 'x' + c.height, css: Math.round(r.width) + 'x' + Math.round(r.height),
                    scale: +(r.width / c.width).toFixed(3), screenShare: Math.round(r.width / innerWidth * 100)};
        })(),
        touch: document.body.classList.contains('touch-controls-enabled'),
        toolbarVisible: !!document.querySelector('#toolbar') &&
            getComputedStyle(document.querySelector('#toolbar')).display !== 'none',
        toolbarClosed: (() => { const t = document.querySelector('#toolbar');
            return !!t && t.classList.contains('closed'); })(),
        toolbarHandler: (() => { const h = document.querySelector('#toolbar-handler');
            if (!h) return 'absent'; const r = h.getBoundingClientRect();
            return getComputedStyle(h).display + '@' + Math.round(r.left) + ',' + Math.round(r.top); })(),
        guideButton: (() => { const b = document.querySelector('#guide-button');
            if (!b) return 'absent'; const r = b.getBoundingClientRect();
            return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top); })(),
        trainerButton: (() => { const b = document.querySelector('#trainer-button');
            if (!b) return 'absent'; const r = b.getBoundingClientRect();
            return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top); })(),
        diagHandle: (() => { const h = document.querySelector('#diagnostics-handle');
            if (!h) return 'absent'; const r = h.getBoundingClientRect();
            return Math.round(r.left) + ',' + Math.round(r.top) + ' display=' + getComputedStyle(h).display; })(),
        guideOpen: !!document.querySelector('#guide[open]'),
        trainerOpen: !!document.querySelector('#trainer[open]'),
        diagnosticsOpen: !!document.querySelector('#diagnostics[open]'),
        font: (window.ranceDiag?.events() || []).filter(e => e.cat === 'font').map(e => e.msg + ' ' + JSON.stringify(e.detail || {})).join(' | '),
    })`);
}

async function click(x, y) {
    const point = {x, y, button: 'left', clickCount: 1};
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', ...point}, sessionId);
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', ...point}, sessionId);
}

while (Date.now() - startedAt < waitMs) {
    await sleep(5000);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    try {
        await updateState();
    } catch (error) {
        // An unresponsive page here is itself a result: the engine hung.
        console.log(`RESULT: main thread unresponsive at t=${elapsed}s (${error.message})`);
        break;
    }
    console.log(`[shots] t=${elapsed}s ${state}`);
    for (const entry of clicks) {
        if (elapsed >= entry.at && !clicked.has(entry)) {
            clicked.add(entry);
            await click(entry.x, entry.y);
            console.log(`[shots] click ${entry.x},${entry.y} at t=${elapsed}s`);
            await sleep(1500);
            await updateState();
            console.log(`[shots] t=${elapsed}s AFTER-CLICK ${state}`);
        }
    }
    if (elapsed >= Math.round(sampleAt / 1000) && !captured) {
        captured = true;
        const image = await send('Page.captureScreenshot', {format: 'png'}, sessionId);
        const file = join(OUT, `${shot}-t${elapsed}.png`);
        await writeFile(file, Buffer.from(image.data, 'base64'));
        console.log(`[shots] screenshot ${file}`);
        try {
            report = await evaluate('window.ranceDiag ? window.ranceDiag.report() : "(no recorder)"');
        } catch (error) {
            report = `(report unavailable: ${error.message})`;
        }
        break;
    }
}

if (report) {
    const file = join(OUT, `${shot}-diag.txt`);
    await writeFile(file, report);
    console.log(`[shots] report  ${file}`);
    for (const line of report.split('\n')) {
        if (/^(encoding|arguments|cjkFontRequested|font|canvas|viewport|touchControls|coarsePointer|engineName):/.test(line))
            console.log(`[shots]   ${line}`);
    }
}

ws.close();
chrome.kill('SIGKILL');
site.close();
process.exit(0);
