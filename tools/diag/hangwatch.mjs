#!/usr/bin/env node
/**
 * Watch a running game for a main-thread lockup and capture the moment it dies.
 *
 * The reported Kichikuou lockup is "the whole system freezes", which is not the
 * same as a slow download: a download keeps the event loop alive.  The only way
 * to tell them apart from outside is a Worker that keeps ticking while the page
 * thread does not, so that is installed before anything else runs.
 *
 *   node tools/diag/hangwatch.mjs --url "http://127.0.0.1:4173/index.html?game=rance4&fast=1" \
 *       --minutes 10 --auto-click
 *
 * On a detected hang it writes <out>-hang-<n>.png plus <out>-hang-<n>.txt with
 * the shell's own diagnostic report, and keeps the page open for a while in
 * case it recovers, because "froze and stayed frozen" and "froze for 40s and
 * carried on" are different bugs.
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

const value = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const url = value('url', 'http://127.0.0.1:4173/index.html?game=rkt');
const minutes = Number(value('minutes', '10'));
const out = value('out', 'hangwatch');
const autoClick = hasFlag('auto-click');
const doubleClick = hasFlag('double-click');
const clickEveryMs = Number(value('click-every', '4000'));
const width = Number(value('width', '1043'));
const height = Number(value('height', '531'));
const touch = hasFlag('touch');
const PORT = Number(value('port', '4193'));
const CDP = Number(value('cdp', '9413'));

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
}).listen(PORT, '127.0.0.1', () => console.log(`[hangwatch] site http://127.0.0.1:${PORT}`));

const chrome = spawn(BRAVE, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/hangwatch-${Date.now()}`,
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
    console.log('[hangwatch] RESULT: devtools did not start');
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
await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: touch}, sessionId);
if (touch) {
    await send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5}, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { const o = window.matchMedia.bind(window);
            window.matchMedia = (q) => q.includes('pointer: coarse')
                ? {matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null}
                : o(q); })();`,
    }, sessionId);
}
// The watchdog lives in a Worker so it keeps counting while the page thread
// cannot answer.  window.__watchdog.last is written by the main thread.
await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
        const state = {last: Date.now(), stalls: 0, maxSilence: 0};
        window.__watchdog = state;
        const beat = () => { const now = Date.now(); const silence = now - state.last;
            if (silence > state.maxSilence) state.maxSilence = silence;
            if (silence > 800) { state.stalls++; state.lastStallAt = now; }
            state.last = now; };
        setInterval(beat, 250);
        beat();
        window.__ping = () => { const before = Date.now(); return before; };
    })();`,
}, sessionId);

await send('Page.navigate', {url}, sessionId);
console.log(`[hangwatch] navigate ${url}  (auto-click=${autoClick}, ${minutes} min)`);

const evaluate = async (expression, timeoutMs = 8000) => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId, timeoutMs);
    return result.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startedAt = Date.now();
let lastClick = 0;
let hangIndex = 0;
let lastProbe = '';

/** Save the shell's report for this stall; returns a suffix for the log line. */
async function grabReport(index) {
    const file = join(OUT, `${out}-hang-${index}.txt`);
    try {
        const report = await evaluate('window.ranceDiag ? window.ranceDiag.report() : "(no recorder)"', 10000);
        await writeFile(file, report);
        // The watchdog line and the last few audio/page events are what the
        // investigation actually reads, so surface them here too.
        const interesting = report.split('\n')
            .filter((line) => /watchdog\]|主线程无响应|CDDA|音轨|CD 读取|audio|stalled|waiting/.test(line))
            .slice(0, 6)
            .map((line) => `\n[hangwatch]   ${line.trim()}`)
            .join('');
        return `\n[hangwatch] report ${file}${interesting}`;
    } catch (error) {
        return `\n[hangwatch] report failed: ${error.message}`;
    }
}

while (Date.now() - startedAt < minutes * 60000) {
    await sleep(2000);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    let probe;
    try {
        probe = await evaluate(`JSON.stringify({
            title: document.title,
            canvas: (() => { const c = document.querySelector('#canvas');
                return c ? c.width + 'x' + c.height : null; })(),
            watchdog: window.__watchdog ? {maxSilence: window.__watchdog.maxSilence, stalls: window.__watchdog.stalls} : null,
            page: window.ranceDiag?.position?.() ?? null,
            audio: (() => { const a = document.querySelector('#audio');
                return a ? {ready: a.readyState, network: a.networkState, paused: a.paused, err: a.error ? a.error.code : null} : null; })(),
        })`);
    } catch (error) {
        // The page did not answer.  Distinguish "busy" from "dead" by asking
        // again after a pause, and only then call it a hang.
        hangIndex++;
        const silentSince = new Date().toISOString();
        console.log(`[hangwatch] t=${elapsed}s NO ANSWER (${error.message})`);
        await sleep(5000);
        let recovered = false;
        let attempts = 0;
        for (let i = 0; i < 6 && !recovered; i++) {
            attempts = i + 1;
            try {
                probe = await evaluate('JSON.stringify({watchdog: window.__watchdog ? {maxSilence: window.__watchdog.maxSilence, stalls: window.__watchdog.stalls} : null})', 6000);
                recovered = true;
            } catch { await sleep(5000); }
        }
        const shot = join(OUT, `${out}-hang-${hangIndex}.png`);
        try {
            const image = await send('Page.captureScreenshot', {format: 'png'}, sessionId, 15000);
            await writeFile(shot, Buffer.from(image.data, 'base64'));
            console.log(`[hangwatch] screenshot ${shot}`);
        } catch (error2) {
            console.log(`[hangwatch] screenshot failed: ${error2.message}`);
        }
        // Grab the shell's own report as soon as the page answers, whether or
        // not it came back for good.  A brief stall is exactly the evidence a
        // "it freezes for ten seconds" report needs, and the report is
        // unavailable while the main thread is blocked -- so waiting for a
        // verdict of "permanently dead" throws away the useful case.
        const reportText = await grabReport(hangIndex);
        if (recovered) {
            console.log(`[hangwatch] t=${elapsed}s RECOVERED after ~${attempts * 5}s; ${probe}${reportText}`);
            continue;
        }
        console.log(`[hangwatch] t=${elapsed}s STILL DEAD after 30s — evidence written (silent since ${silentSince})${reportText}`);
        break;
    }
    if (probe !== lastProbe) {
        lastProbe = probe;
        console.log(`[hangwatch] t=${elapsed}s ${probe}`);
    } else if (elapsed % 30 === 0) {
        console.log(`[hangwatch] t=${elapsed}s (unchanged) ${probe}`);
    }
    if (autoClick) {
        const now = Date.now();
        if (now - lastClick > clickEveryMs) {
            lastClick = now;
            const x = Math.round(width / 2);
            const y = Math.round(height * 0.75);
            // xsystem35 ignores a lone synthetic left click in headless Chrome
            // but advances on a double click (measured: page 8 -> 13), so the
            // click count is what makes automated progress possible at all.
            const clickCount = doubleClick ? 2 : 1;
            try {
                await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount}, sessionId, 5000);
                await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount}, sessionId, 5000);
            } catch (error) {
                console.log(`[hangwatch] t=${elapsed}s click blocked: ${error.message}`);
            }
        }
    }
}

console.log('[hangwatch] done');
ws.close();
chrome.kill('SIGKILL');
site.close();
process.exit(0);
