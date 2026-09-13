// Verifies the trainer bridge against a real running game.
//
//   * serves dist/ on 4173 (game data included, no remote proxy needed)
//   * drives Brave over CDP
//   * checks the exported cheat_* accessors against independent evidence:
//       - xsystem35: cheat_page() must equal the pre-existing _nact_current_page()
//       - rance4:    cheat_var_name() must return names that come from
//                    System39.ain's VARI chunk (decoded independently offline)
//       - both:      cheat_var_ptr() view must agree with cheat_get_var(),
//                    and a set/get round trip must be visible through the view
//   * screenshots the trainer dialog
//
// usage: node tools/diag/verify-cheats.mjs --game rance41 [--keep-open]
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
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
  '.woff2': 'font/woff2', '.map': 'application/json',
};

async function serveFile(req, res, filePath) {
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) return serveFile(req, res, join(filePath, 'index.html'));
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const buf = await readFile(filePath);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : st.size - 1;
      res.writeHead(206, {
        'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
      });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('not found');
  }
}

function connectWs(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error('websocket error'));
  });
}

// The probe runs inside the page.  Everything it needs is passed in as JSON.
const PROBE = (expected) => `(async () => {
  const expected = ${JSON.stringify(expected)};
  const out = {ok: false, checks: [], errors: []};
  const note = (name, pass, detail) => out.checks.push({name, pass: !!pass, detail});
  try {
    const M = window.Module;
    if (!M || typeof M._cheat_var_count !== 'function') {
      out.errors.push('cheat exports missing on Module');
      return out;
    }
    const engineId = M._cheat_engine_id();
    out.engine = engineId === 2 ? 'system3' : 'xsystem35';
    note('engine_id_matches_expected_game', out.engine === expected.engine,
         out.engine + ' vs expected ' + expected.engine);

    const count = M._cheat_var_count();
    out.varCount = count;
    note('var_count_positive', count > 0, count);

    const ptr = M._cheat_var_ptr();
    note('var_ptr_nonzero', ptr > 0, '0x' + ptr.toString(16));
    const view = new Uint16Array(M.HEAPU8.buffer, ptr, count);

    // 1. bulk view must agree with the scalar getter.
    let mismatch = 0;
    const step = Math.max(1, Math.floor(count / 200));
    const sampled = [];
    for (let i = 0; i < count; i += step) {
      sampled.push(i);
      if (view[i] !== M._cheat_get_var(i)) mismatch++;
    }
    note('view_matches_scalar_getter', mismatch === 0,
         'checked ' + sampled.length + ' indices, ' + mismatch + ' mismatches');

    // 2. non-zero population, so the table is clearly live data and not zeros.
    let nonZero = 0;
    for (let i = 0; i < count; i++) if (view[i] !== 0) nonZero++;
    out.nonZeroVars = nonZero;
    note('table_is_not_all_zero', nonZero > 0, nonZero + ' non-zero of ' + count);

    // 3. write/read round trip on high indices, then restore.
    const probes = expected.probeIndices.filter((i) => i < count);
    const roundTrip = [];
    for (const index of probes) {
      const original = M._cheat_get_var(index);
      const target = original === 12345 ? 23456 : 12345;
      const written = M._cheat_set_var(index, target);
      const readBack = M._cheat_get_var(index);
      const viaView = new Uint16Array(M.HEAPU8.buffer, ptr, count)[index];
      M._cheat_set_var(index, original);
      const restored = M._cheat_get_var(index);
      roundTrip.push({index, original, target, written, readBack, viaView, restored});
    }
    out.roundTrip = roundTrip;
    note('write_read_round_trip', roundTrip.length > 0 && roundTrip.every(
      (r) => r.written === r.target && r.readBack === r.target && r.viaView === r.target && r.restored === r.original),
      JSON.stringify(roundTrip));

    // 4. current page.  xsystem35 has an independent pre-existing export.
    const page = M._cheat_page();
    const addr = M._cheat_addr();
    out.page = page; out.addr = addr;
    note('page_is_number', Number.isFinite(page) && page >= 0, page);
    if (typeof M._nact_current_page === 'function') {
      const independent = M._nact_current_page();
      out.independentPage = independent;
      note('page_matches_pre_existing_export', independent === page,
           'cheat=' + page + ' nact=' + independent);
    }

    // 5. variable names.  For rance4 these come from System39.ain's VARI chunk,
    //    decoded independently offline; the strings below are from that decode.
    //    The raw exports return C pointers, so decode through the heap exactly
    //    like shell/trainer.ts does.
    const decoder = new TextDecoder('utf-8');
    const readCStr = (p) => {
      if (!p) return '';
      const heap = M.HEAPU8;
      let end = p;
      while (heap[end]) end++;
      return decoder.decode(heap.subarray(p, end));
    };
    const names = [];
    for (const index of expected.nameProbes) names.push(readCStr(M._cheat_var_name(index)));
    out.names = names;
    if (expected.expectedNames) {
      const pass = JSON.stringify(names) === JSON.stringify(expected.expectedNames);
      note('var_names_match_offline_ain_decode', pass,
           JSON.stringify(names) + ' vs ' + JSON.stringify(expected.expectedNames));
    } else {
      note('var_names_are_strings', names.every((n) => typeof n === 'string' && n.length > 0),
           JSON.stringify(names));
    }

    // 6. string variables reachable.
    const strCount = M._cheat_strvar_count();
    out.strVarCount = strCount;
    note('strvar_count_positive', strCount > 0, strCount);
    if (strCount > 0) {
      const before = readCStr(M._cheat_get_strvar(0));
      M._cheat_set_strvar(0, M.stringToUTF8OnStack('TRAINER-PROBE'));
      const after = readCStr(M._cheat_get_strvar(0));
      M._cheat_set_strvar(0, M.stringToUTF8OnStack(before));
      const restored = readCStr(M._cheat_get_strvar(0));
      out.strVarProbe = {before, after, restored};
      note('strvar_round_trip', after === 'TRAINER-PROBE' && restored === before,
           JSON.stringify({before, after, restored}));
    }

    // 7. Independent cross-check of the read channel: on the Rance 4 title
    //    screen VAR0001..VAR0004 looked like year/month/day/hour taken from the
    //    host clock.  Compare them against the browser's own clock.  Matching
    //    four components is evidence that the table is the engine's live state
    //    and not a copy we made up.
    const now = new Date();
    const clock = {year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours()};
    const dateVars = [1, 2, 3, 4].map((i) => M._cheat_get_var(i));
    out.clock = clock;
    out.dateVars = dateVars;
    if (out.engine === 'xsystem35') {
      const dateMatches = dateVars[0] === clock.year && dateVars[1] === clock.month &&
          dateVars[2] === clock.day && dateVars[3] === clock.hour;
      note('var1to4_match_host_clock', dateMatches,
           'vars=' + JSON.stringify(dateVars) + ' clock=' + JSON.stringify(clock));
    }

    out.ok = out.checks.every((c) => c.pass);
  } catch (e) {
    out.errors.push(String(e && e.stack || e));
  }
  return out;
})()`;

const EXPECTED = {
  rance4: {
    engine: 'xsystem35',
    probeIndices: [65000, 65001, 65530],
    nameProbes: [9, 118, 353, 354],
    expectedNames: ['VAR0009_menuCurrentStringNumber', 'VAR0118_currentCharacter',
                    'VAR0353_roomImage', 'VAR0354_roomNumber'],
  },
  rance41: {engine: 'system3', probeIndices: [700, 701, 766], nameProbes: [0, 5, 700]},
  rance42: {engine: 'system3', probeIndices: [700, 701, 766], nameProbes: [0, 5, 700]},
};

async function main() {
  await mkdir(OUT, {recursive: true});
  const args = process.argv.slice(2);
  const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const game = getArg('--game', 'rance41');
  const port = Number(getArg('--port', '9241'));
  const waitMs = Number(getArg('--wait-ms', '120000'));
  const keepOpen = args.includes('--keep-open');
  const expected = EXPECTED[game];
  if (!expected) {
    console.error('unknown game: ' + game);
    process.exit(2);
  }

  const site = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = join(DIST, url === '/' ? 'index.html' : url);
    if (!p.startsWith(DIST)) return res.writeHead(403).end();
    serveFile(req, res, p);
  }).listen(4173, '127.0.0.1');

  const profile = join(OUT, `profile-cheat-${game}`);
  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const chrome = spawn(brave, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
    '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--use-gl=swiftshader',
    '--disable-software-rasterizer', '--in-process-gpu',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'ignore']});

  let up = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) { chrome.kill('SIGKILL'); site.close(); console.error('devtools did not start'); process.exit(1); }

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = await connectWs(version.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const consoleMsgs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const {resolve: res, reject: rej} = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled')
      consoleMsgs.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    else if (m.method === 'Runtime.exceptionThrown')
      consoleMsgs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, {resolve: res, reject: rej});
    ws.send(JSON.stringify({id, method, params, ...(sid ? {sessionId: sid} : {})}));
  });

  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  const evaluateInPage = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot = async (name) => {
    const {data} = await send('Page.captureScreenshot', {format: 'png'}, sessionId);
    const p = join(OUT, `cheat-${game}-${name}.png`);
    await writeFile(p, Buffer.from(data, 'base64'));
    return p;
  };

  const url = `http://127.0.0.1:4173/index.html?game=${game}`;
  await send('Page.navigate', {url}, sessionId);

  // Wait for the engine to publish its cheat exports.
  const deadline = Date.now() + waitMs;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = await evaluateInPage(`!!(window.Module && typeof Module._cheat_var_count === 'function')`);
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  const result = {game, url, ready, consoleTail: consoleMsgs.slice(-15)};
  if (ready) {
    // Give the game a moment to reach a stable screen before probing.
    await new Promise((r) => setTimeout(r, 3000));
    result.gameScreen = await shot('screen');
    result.probe = await evaluateInPage(PROBE(expected));
    try {
      await evaluateInPage(`window.ranceTrainer.open(); true`);
      await new Promise((r) => setTimeout(r, 1000));
      result.trainerScreenshot = await shot('trainer');
      result.trainerDom = await evaluateInPage(`(() => {
        const d = document.querySelector('#trainer');
        if (!d) return null;
        const tabs = [...d.querySelectorAll('.trainer-tabs .tab-item a')];
        const base = {
          open: d.open,
          tabs: tabs.map(a => a.textContent),
          status: d.querySelector('.trainer-status')?.textContent,
          panelVisible: [...d.querySelectorAll('.trainer-panel')].filter(p => !p.hidden).map(p => p.dataset.panel),
        };
        tabs.find(a => a.textContent.includes('变量浏览')).click();
        const rows = [...d.querySelectorAll('.trainer-panel[data-panel=vars] .trainer-var-table tbody tr')];
        base.varPanel = {
          summary: d.querySelector('.trainer-panel[data-panel=vars] .trainer-summary')?.textContent,
          rowCount: rows.length,
          sampleRows: rows.slice(0, 4).map(r => [...r.querySelectorAll('td')].map(
            c => (c.querySelector('input') ? c.querySelector('input').value : c.textContent))),
        };
        return base;
      })()`);
      result.trainerVarsScreenshot = await shot('trainer-vars');
      await evaluateInPage(`(() => {
        const d = document.querySelector('#trainer');
        [...d.querySelectorAll('.trainer-tabs .tab-item a')]
          .find(a => a.textContent.includes('常用修改')).click();
        return true;
      })()`);

      // Exercise the search tab end to end: scan for a value we just wrote.
      result.searchExercise = await evaluateInPage(`(async () => {
        const M = window.Module;
        M._cheat_set_var(700, 4242);
        const d = document.querySelector('#trainer');
        const tabs = [...d.querySelectorAll('.trainer-tabs .tab-item a')];
        tabs.find(a => a.textContent.includes('数值搜索')).click();
        const valueInput = d.querySelector('.trainer-panel[data-panel=search] .trainer-toolbar input[type=number]');
        valueInput.value = '4242';
        [...d.querySelectorAll('.trainer-panel[data-panel=search] button')].find(b => b.textContent === '首次扫描').click();
        const summary = d.querySelector('.trainer-panel[data-panel=search] .trainer-summary')?.textContent;
        const rows = d.querySelectorAll('.trainer-search-results .trainer-search-row').length;
        M._cheat_set_var(700, 0);
        return {summary, rows};
      })()`);
      result.trainerSearchScreenshot = await shot('trainer-search');

      // Freeze ("锁定"): after locking a row, an external write must be undone
      // by the lock timer.
      await evaluateInPage(`(() => {
        const M = window.Module;
        M._cheat_set_var(701, 111);
        const d = document.querySelector('#trainer');
        [...d.querySelectorAll('.trainer-tabs .tab-item a')]
          .find(a => a.textContent.includes('变量浏览')).click();
        const filter = d.querySelector('.trainer-panel[data-panel=vars] input[type=search]');
        filter.value = '701';
        filter.dispatchEvent(new Event('input', {bubbles: true}));
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      const lockArmed = await evaluateInPage(`(() => {
        const d = document.querySelector('#trainer');
        const row = [...d.querySelectorAll('.trainer-panel[data-panel=vars] .trainer-var-table tbody tr')]
          .find(r => r.querySelector('td')?.textContent === '701');
        if (!row) return false;
        row.querySelector('input[type=checkbox]').click();
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 700));
      const lockResult = await evaluateInPage(`(async () => {
        const M = window.Module;
        M._cheat_set_var(701, 999);
        const immediately = M._cheat_get_var(701);
        await new Promise(r => setTimeout(r, 1200));
        const afterLock = M._cheat_get_var(701);
        if (afterLock === 111) M._cheat_set_var(701, 0);
        return {immediately, afterLock};
      })()`);
      result.lock = {armed: lockArmed, ...lockResult};
      await evaluateInPage(`(async () => {
        const d = document.querySelector('#trainer');
        const row = [...d.querySelectorAll('.trainer-panel[data-panel=vars] .trainer-var-table tbody tr')]
          .find(r => r.querySelector('td')?.textContent === '701');
        const box = row?.querySelector('input[type=checkbox]');
        if (box && box.checked) box.click();
        window.Module._cheat_set_var(701, 0);
        return true;
      })()`);
    } catch (e) {
      result.trainerError = String(e);
    }

    // Guide viewer: registered content, section count, progress line, and the
    // manual "mark chapter done" round trip.
    try {
      result.guide = await evaluateInPage(`(() => {
        if (!window.ranceGuide) return {available: false};
        window.ranceGuide.open();
        const d = document.querySelector('#guide');
        if (!d) return {available: false};
        const navItems = [...d.querySelectorAll('.guide-nav-item')];
        const out = {
          available: true,
          open: d.open,
          sectionCount: navItems.length,
          sections: navItems.map(a => a.textContent),
          progressBefore: d.querySelector('.guide-progress')?.textContent,
          firstSectionText: (d.querySelector('.guide-content')?.textContent || '').slice(0, 160),
          sourceCount: d.querySelectorAll('.guide-sources li').length,
        };
        d.querySelector('.guide-done')?.click();
        out.progressAfterDone = d.querySelector('.guide-progress')?.textContent;
        out.doneMarked = !!d.querySelector('.guide-nav-item.done');
        d.querySelector('.guide-done')?.click();
        out.progressAfterUndo = d.querySelector('.guide-progress')?.textContent;
        return out;
      })()`);
      result.guideScreenshot = await shot('guide');
    } catch (e) {
      result.guideError = String(e);
    }

    // Launcher integration: the tools panel must expose working entry points.
    try {
      result.launcherPanel = await evaluateInPage(`(() => {
        const panel = document.querySelector('.guide-tools');
        if (!panel) return {present: false};
        return {
          present: true,
          hidden: panel.hidden,
          text: panel.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
          hasGuideButton: !!panel.querySelector('[data-open-guide]'),
          hasTrainerButton: !!panel.querySelector('[data-open-trainer]'),
        };
      })()`);
    } catch (e) {
      result.launcherError = String(e);
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (keepOpen) {
    console.log('[verify] keeping brave open, pid', chrome.pid);
    return;
  }
  chrome.kill('SIGKILL');
  site.close();
  process.exit(result.probe?.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
