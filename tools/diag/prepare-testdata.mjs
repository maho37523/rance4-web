#!/usr/bin/env node
/**
 * Prepare (or remove) the local test data the diagnostic harnesses load.
 *
 * The public launcher imports the four Chinese ALDs through the real manifest,
 * but that manifest points at a remote proxy and the browser caches it.  For
 * local verification we point the launcher at the game folder on this machine:
 *
 *   * dist/games/ranceking-test/  -> symlinks to the four ALDs, the CD image
 *                                   and the GBK font, plus a manifest
 *   * dist/autostart.js           -> a `?game=rkt` route that dispatches the
 *                                   load-remote-files event with encoding=gbk
 *
 * autostart.js is a build artifact that is *not* tracked by git, and the route
 * is appended, so removing it restores the published file.
 *
 *   node tools/diag/prepare-testdata.mjs            # create
 *   node tools/diag/prepare-testdata.mjs --clean    # remove
 */
import {cp, mkdir, rm, symlink, stat, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const APP = resolve(import.meta.dirname, '..', '..');
const DIST = join(APP, 'dist');
const TEST_ID = 'ranceking-test';
const TEST_DIR = join(DIST, 'games', TEST_ID);
const AUTOSTART = join(DIST, 'autostart.js');
const MARKER = '// --- local test route (managed by tools/diag/prepare-testdata.mjs) ---';

const PROJECT = resolve(APP, '..');
const GAMES_DIR = process.env.GAMES_DIR ? resolve(process.env.GAMES_DIR) : join(PROJECT, 'games');
const RANCE_KING = join(GAMES_DIR, 'RANCE KING');
const CD_DIR = join(RANCE_KING, '需要加载此镜像，否则无声音，设为第一光驱位置');

// The Chinese ALDs use a non-ASCII name; keep the mapping explicit.
const FILES = [
  ['婼抺墹SA.ALD', 'SA.ALD'],
  ['婼抺墹GA.ALD', 'GA.ALD'],
  ['婼抺墹GB.ALD', 'GB.ALD'],
  ['婼抺墹WA.ALD', 'WA.ALD'],
];

const ROUTE = `
${MARKER}
async function __startTestGame() {
  const root = new URL('games/${TEST_ID}/', document.baseURI);
  const manifest = await (await fetch(new URL('manifest.json', root))).json();
  const files = [];
  for (const entry of manifest.files)
    files.push(new File([await (await fetch(new URL(entry.path, root))).blob()], entry.path));
  document.dispatchEvent(new CustomEvent('load-remote-files', {detail: {
    files,
    imageUrl: new URL(manifest.imageUrl, document.baseURI).href,
    cueUrl: new URL(manifest.cueUrl, document.baseURI).href,
    encoding: 'gbk',
  }}));
}
if (new URLSearchParams(location.search).get('game') === 'rkt')
  __startTestGame().catch(e => console.error('test start failed', e));
`;

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function clean() {
  await rm(TEST_DIR, {recursive: true, force: true});
  try {
    const src = readFileSync(AUTOSTART, 'utf8');
    const i = src.indexOf(MARKER);
    if (i >= 0) await writeFile(AUTOSTART, src.slice(0, i));
    console.log('removed test data and launcher route');
  } catch {
    console.log('removed test data (dist/autostart.js not present)');
  }
}

async function create() {
  if (!(await exists(RANCE_KING))) {
    console.error(`game data not found: ${RANCE_KING}\nSet GAMES_DIR if it lives elsewhere.`);
    process.exit(1);
  }
  await mkdir(TEST_DIR, {recursive: true});
  const missing = [];
  for (const [from, to] of FILES) {
    const src = join(RANCE_KING, from);
    if (!(await exists(src))) { missing.push(from); continue; }
    await rm(join(TEST_DIR, to), {force: true});
    await symlink(src, join(TEST_DIR, to));
  }
  const cdImg = join(CD_DIR, 'kichiku_CD-DA.img');
  const cdCue = join(CD_DIR, 'kichiku_CD-DA.cue');
  if (await exists(cdImg)) { await rm(join(TEST_DIR, 'cd.img'), {force: true}); await symlink(cdImg, join(TEST_DIR, 'cd.img')); }
  if (await exists(cdCue)) { await rm(join(TEST_DIR, 'cd.cue'), {force: true}); await symlink(cdCue, join(TEST_DIR, 'cd.cue')); }
  const font = join(DIST, 'games', 'rance4', 'SourceHanSansCN-Normal.otf');
  if (await exists(font)) {
    await rm(join(TEST_DIR, 'SourceHanSansCN-Normal.otf'), {force: true});
    await symlink(font, join(TEST_DIR, 'SourceHanSansCN-Normal.otf'));
  }

  await writeFile(join(TEST_DIR, 'manifest.json'), JSON.stringify({
    id: TEST_ID,
    name: 'ranceking (local test)',
    published: true,
    baseUrl: `games/${TEST_ID}/`,
    files: FILES.map(([, to]) => ({path: to})),
    imageUrl: `games/${TEST_ID}/cd.img`,
    cueUrl: `games/${TEST_ID}/cd.cue`,
  }, null, 2) + '\n');

  const src = readFileSync(AUTOSTART, 'utf8');
  if (!src.includes(MARKER)) await writeFile(AUTOSTART, src + ROUTE);

  if (missing.length) console.warn('missing game files:', missing.join(', '));
  console.log(`test data ready: ${TEST_DIR}`);
  console.log('load  http://127.0.0.1:4173/?game=rkt');
}

const cleanMode = process.argv.includes('--clean');
await (cleanMode ? clean() : create());
