import {renderToolsPanel} from './tools-registry.js';
import {installDiagnostics} from './shell.js';

// The recorder goes in before any await, so a failure inside the first
// manifest fetch is still on the timeline.
installDiagnostics();

const games = {
  rance4: {name: '兰斯 4：教团的遗产', resourceStrategy: 'published'},
  rance41: {name: '兰斯 4.1：拯救制药厂', resourceStrategy: 'published'},
  rance42: {name: '兰斯 4.2：天使组', resourceStrategy: 'published'},
  ranceking: {name: '鬼畜王兰斯', resourceStrategy: 'local-import'},
};

function showLocalImport(game) {
  const gameInfo = games[game];
  document.title = `${gameInfo.name} · Rance Web`;
  document.querySelector('.navbar-brand').textContent = gameInfo.name;
  document.querySelector('#loader h1').textContent = gameInfo.name;
  document.querySelector('#loader .game-picker').hidden = true;
  document.querySelector('#local-import').hidden = false;
  const status = document.querySelector('#loader .local-status');
  status.hidden = false;
  status.textContent = '请选择游戏根目录中的四个 ALD（SA/GA/GB/WA）文件、可选的 SA.ASD，以及 kichiku_CD-DA.img 和 kichiku_CD-DA.cue。';
  const input = document.querySelector('#fileselect');
  input.classList.remove('hidden-while-loading');
  input.click();
}

function remoteManifestUrls(manifest, gameRoot) {
  if (manifest.published !== true || !Array.isArray(manifest.files) ||
      manifest.files.length === 0 || typeof manifest.imageUrl !== 'string' ||
      typeof manifest.cueUrl !== 'string' || !manifest.imageUrl || !manifest.cueUrl)
    return null;
  const baseUrl = typeof manifest.baseUrl === 'string' ? manifest.baseUrl : '';
  try {
    const resolve = (value) => new URL(value, new URL(baseUrl || '.', gameRoot));
    const files = manifest.files.map((entry) => {
      const item = typeof entry === 'string' ? {path: entry} : entry;
      if (!item || typeof item.path !== 'string' || !item.path)
        throw new Error('发布清单中的 ALD 条目无效');
      const urlValue = typeof item.url === 'string' && item.url ? item.url : item.publicPath || item.path;
      if (typeof urlValue !== 'string' || !urlValue)
        throw new Error(`发布清单缺少 ${item.path} 的 URL`);
      return {
        path: item.path,
        url: resolve(urlValue),
        version: typeof item.sha256 === 'string' ? item.sha256 : '',
        size: typeof item.size === 'number' && item.size > 0 ? item.size : 0,
      };
    });
    return {files, imageUrl: resolve(manifest.imageUrl).href, cueUrl: resolve(manifest.cueUrl).href};
  } catch (error) {
    throw error instanceof Error ? error : new Error('发布清单 URL 无效');
  }
}

// Music is the one asset class that must not be downloaded up front: Rance 4
// ships 40 tracks totalling 82 MB, far past what a mobile connection will
// tolerate before the title screen.  Gather their URLs instead so the player
// can fetch a track when the script actually asks for it.
//
// The playlist (_inmm.ini, or playlist.txt) maps track numbers to file names.
// Fetching it costs a few kB and tells the player which file is track N.
async function collectBgmTracks(entries) {
  const audio = entries.filter((e) => /\.(mp3|ogg|wav)$/i.test(e.path));
  const urls = new Map();
  for (const e of audio)
    urls.set(e.path.split('/').pop(), e.url);
  if (urls.size === 0)
    return undefined;

  const playlistEntry = entries.find((e) => {
    const name = e.path.split('/').pop().toLowerCase();
    return name === '_inmm.ini' || name === 'playlist.txt';
  });
  let playlistName;
  let playlistText;
  if (playlistEntry) {
    try {
      const res = await fetch(playlistEntry.url);
      if (res.ok) {
        playlistText = await res.text();
        playlistName = playlistEntry.path.split('/').pop();
      }
    } catch (e) {
      console.warn('无法读取曲目列表，改用文件名编号：', e);
    }
  }
  return {playlistName, playlistText, urls};
}

// Files the interpreters never read as game data.
//   audio: isGameDataFile() skips mp3/ogg/wav (the runtime streams CD tracks
//          from the disc image or reads BGM from an ALD)
//   exe/dll: skipped as well, and the console logs "Skipping ..." for each
// Rance 4's manifest listed 40 BGM tracks plus RANCE4CN.EXE: together 87 MB of
// a 106 MB start transfer that the engine discarded unread.
function isUnusedStartFile(path) {
  return /\.(mp3|ogg|wav|exe|dll)$/i.test(path);
}

// Download one file in chunks with retries. A single fetch() of a 19-29 MB ALD
// is what made the public builds fail outright on mobile: one dropped
// connection discarded the whole request.
//
// Whole archives are kept in Cache Storage so a second visit downloads nothing
// and only has to be validated.  The cache name is versioned so a future change
// to the layout starts clean; a released asset also changes key because the
// manifest hash is part of it.
const GAME_CACHE = 'game-data-v1';

function gameCacheKey(entry) {
  // This is a Cache Storage key only; it is never sent over the network.  The
  // asset hash makes a released data update naturally invalidate old files.
  const id = encodeURIComponent(`${entry.path}:${entry.version || entry.url}`);
  return new Request(new URL(`__game_cache__/${id}`, document.baseURI).href);
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check a cached blob against what the manifest says this file should be.
 *
 * Size is always compared because it is free.  The hash is only computed when
 * the manifest supplies one, which sha256-carrying manifests do; a size-only
 * match still catches the truncation that a dropped connection produces.
 */
async function cacheEntryIsValid(blob, entry) {
  if (!blob || blob.size === 0)
    return false;
  if (typeof entry.size === 'number' && entry.size > 0 && blob.size !== entry.size) {
    console.warn(`${entry.path}: 缓存大小 ${blob.size} != ${entry.size}，重新下载`);
    return false;
  }
  if (entry.version) {
    if (await sha256Hex(blob) !== entry.version) {
      console.warn(`${entry.path}: 缓存校验和不匹配，重新下载`);
      return false;
    }
  }
  return true;
}

async function cachedGameFile(entry, onProgress) {
  let cache;
  try {
    cache = await caches.open(GAME_CACHE);
    const hit = await cache.match(gameCacheKey(entry));
    if (hit) {
      const blob = await hit.blob();
      if (await cacheEntryIsValid(blob, entry)) {
        onProgress?.(blob.size, blob.size, true);
        return blob;
      }
      // A corrupt or outdated copy must not shadow the network.
      await cache.delete(gameCacheKey(entry));
    }
  } catch (e) {
    // Storage can be unavailable in private mode or under quota pressure. A
    // normal network load must still work in that case.
    console.warn('游戏缓存不可用，改用网络加载：', e);
  }

  const blob = await fetchGameFile(entry.url, entry.path, onProgress, entry.size);
  if (cache) {
    try {
      await cache.put(gameCacheKey(entry), new Response(blob));
    } catch (e) {
      // Most likely the origin is out of quota.  The game still runs; the user
      // just pays for the download again next time.
      console.warn('无法保存游戏缓存：', e);
      reportCacheFailure(e);
    }
  }
  return blob;
}

/**
 * Whole-file fetch backed by the game-data cache.  Exposed for the shell so the
 * GBK font (8 MB, fetched outside the manifest download) is stored once too;
 * without this the font alone was re-downloaded on every visit.
 */
async function fetchCachedWholeFile(url) {
  const entry = {path: String(url).split('/').pop() || 'file', url: String(url)};
  return await cachedGameFile(entry);
}
window.dshFetchCachedFile = fetchCachedWholeFile;

let cacheFailureReported = false;
function reportCacheFailure(error) {
  if (cacheFailureReported)
    return;
  cacheFailureReported = true;
  const message = (error && (error.name || error.message)) || '未知错误';
  console.warn(`游戏缓存写入失败（${message}），本次仍可正常游玩，但下次需要重新下载。`);
}

/**
 * Ask the browser to keep game data across restarts.  Without this, storage
 * under pressure can be evicted and the "download once" promise breaks.
 */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist)
      return;
    if (await navigator.storage.persisted())
      return;
    const granted = await navigator.storage.persist();
    console.log(granted ? '游戏数据已获准长期保存' : '浏览器未授予长期保存，缓存可能被清理');
  } catch (e) {
    console.warn('无法申请长期存储：', e);
  }
}

async function fetchGameFile(url, label, onProgress, declaredSize = 0) {
  let total = declaredSize;
  if (!total) {
    try {
      const head = await fetch(url, {headers: {'Range': 'bytes=0-0'}});
      if (head.status === 206) {
        const m = /^bytes \d+-\d+\/(\d+)$/.exec(head.headers.get('Content-Range') || '');
        if (m) total = Number(m[1]);
      }
    } catch {}
  }

  // Prefer one request for the whole archive.
  //
  // The release CDN does not reliably honour Range requests, and the proxy
  // answers 502 ("Invalid release range") whenever the upstream ignores one.
  // Chunking a 19-29 MiB ALD into 1 MiB pieces therefore multiplied the request
  // count fourfold and turned a flaky upstream into a total load failure.
  if (total > 0) {
    try {
      const blob = await fetchWholeWithRetry(url, total, onProgress);
      if (blob) return blob;
    } catch (e) {
      console.warn(`${label}: 整包下载失败，改用分段续传：`, e);
    }
  }
  return await fetchInChunks(url, label, total, onProgress);
}

async function fetchWholeWithRetry(url, total, onProgress) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      onProgress?.(0, total, false);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const expected = total || Number(res.headers.get('Content-Length')) || 0;
      const blob = await readResponseBlob(res, (received) =>
        onProgress?.(received, expected, false));
      if (expected && blob.size !== expected) throw new Error(`size ${blob.size} != ${expected}`);
      return blob;
    } catch (e) {
      lastError = e;
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// Report as data arrives instead of waiting for Response.blob(). Large archives
// otherwise make the mobile loader appear stuck even while the network is busy.
// Reporting is throttled to keep DOM work below the network read frequency.
async function readResponseBlob(res, onProgress) {
  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    onProgress?.(blob.size, true);
    return blob;
  }
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  let reportedAt = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    const now = Date.now();
    if (now - reportedAt >= 200) {
      reportedAt = now;
      onProgress?.(received, false);
    }
  }
  onProgress?.(received, true);
  return new Blob(parts);
}

// Fallback only: the proxy limits one range to 4 MiB, so stay under that and
// retry each piece.  Used when a single request cannot deliver the file.
async function fetchInChunks(url, label, total, onProgress) {
  if (!total) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法读取 ${label}（${res.status}）`);
    const blob = await res.blob();
    onProgress?.(blob.size, blob.size, false);
    return blob;
  }
  const chunk = 4 << 20;
  const parts = [];
  let done = 0;
  for (let offset = 0; offset < total; offset += chunk) {
    const end = Math.min(offset + chunk, total) - 1;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {headers: {'Range': `bytes=${offset}-${end}`}});
        if (res.status !== 206) throw new Error(`status ${res.status}`);
        const expected = `bytes ${offset}-${end}/${total}`;
        if (res.headers.get('Content-Range') !== expected)
          throw new Error(`unexpected range ${res.headers.get('Content-Range')}`);
        const blob = await readResponseBlob(res, (received) =>
          onProgress?.(done + received, total, false));
        if (blob.size !== end - offset + 1) throw new Error(`short chunk ${blob.size}`);
        parts.push(blob);
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
        if (attempt === 4) throw new Error(`无法读取 ${label}：${e.message}`);
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
    if (lastError) throw new Error(`无法读取 ${label}`);
    done = end + 1;
    onProgress?.(done, total, false);
  }
  return new Blob(parts);
}

async function downloadGameFiles(entries, status) {
  const files = new Array(entries.length);
  const loaded = new Array(entries.length).fill(0);
  const totals = entries.map((entry) => entry.size || 0);
  const cached = new Array(entries.length).fill(false);
  const renderProgress = () => {
    // Cache hits are not downloads, so they are excluded from the byte count --
    // otherwise a fully cached start would look like it was transferring
    // everything again.  The file count still includes them, because they are
    // ready to use.
    let done = 0, known = 0, cacheCount = 0;
    for (let i = 0; i < entries.length; i++) {
      if (cached[i]) { cacheCount++; continue; }
      const expected = entries[i].size || totals[i];
      if (expected > 0) { done += loaded[i]; known += expected; }
    }
    const complete = files.filter(Boolean).length;
    const amount = known > 0 ? `，${(done / 1048576).toFixed(1)} / ${(known / 1048576).toFixed(1)} MB` : '';
    const reused = cacheCount > 0 ? `，已复用缓存 ${cacheCount} 个` : '';
    status.textContent = `正在加载原始游戏文件：${complete} / ${entries.length}${amount}${reused}`;
  };
  renderProgress();
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const entry = entries[i];
      const blob = await cachedGameFile(entry, (current, total, fromCache) => {
        loaded[i] = current;
        totals[i] = entries[i].size || total;
        cached[i] = fromCache;
        renderProgress();
      });
      files[i] = new File([blob], entry.path.split('/').pop());
      renderProgress();
    }
  };
  // Two connections keep mobile radio throughput busy without creating four
  // simultaneous multi-megabyte buffers and triggering memory pressure.
  await Promise.all(Array.from({length: Math.min(2, entries.length)}, worker));
  return files;
}

async function startRanceKing() {
  const game = 'ranceking';
  const gameInfo = games[game];
  document.title = `${gameInfo.name} · Rance Web`;
  document.querySelector('.navbar-brand').textContent = gameInfo.name;
  document.querySelector('#loader h1').textContent = gameInfo.name;
  document.querySelector('#loader .game-picker').hidden = true;
  const status = document.querySelector('#loader .local-status');
  status.hidden = false;
  await requestPersistentStorage();
  try {
    const gameRoot = new URL(`games/${game}/`, document.baseURI);
    const response = await fetch(new URL('manifest.json', gameRoot));
    if (!response.ok) throw new Error(`发布清单读取失败（${response.status}）`);
    const manifest = await response.json();
    const remote = remoteManifestUrls(manifest, gameRoot);
    if (!remote) {
      showLocalImport(game);
      return;
    }
    // Audio is never handed to the interpreters as game data: the runtime
    // either streams CD tracks from the disc image or reads BGM from an ALD.
    // Fetching it anyway made a published Rance 4 start transfer 82 MB of the
    // 106 MB payload before the title screen, which never finished on mobile.
    const downloadable = remote.files.filter((entry) => !isUnusedStartFile(entry.path));
    const files = await downloadGameFiles(downloadable, status);
    // Music kept out of the download above still has to reach the player.
    const bgm = await collectBgmTracks(remote.files.map((e) => ({path: e.path, url: e.url})));
    document.dispatchEvent(new CustomEvent('load-remote-files', {
      detail: {files, imageUrl: remote.imageUrl, cueUrl: remote.cueUrl, encoding: 'gbk', bgm},
    }));
  } catch (error) {
    status.textContent = `加载失败：${error instanceof Error ? error.message : error}`;
    console.error(error);
  }
}

async function startSelectedGame() {
  const game = new URLSearchParams(location.search).get('game');
  if (!game || !games[game]) return;
  renderToolsPanel(game);
  if (games[game].resourceStrategy === 'local-import') {
    if (game === 'ranceking') {
      await startRanceKing();
    } else {
      showLocalImport(game);
    }
    return;
  }
  document.title = `${games[game].name} · Rance Web`;
  document.querySelector('.navbar-brand').textContent = games[game].name;
  document.querySelector('#loader h1').textContent = games[game].name;
  document.querySelector('#loader .game-picker').hidden = true;
  const status = document.querySelector('#loader .local-status');
  status.hidden = false;
  await requestPersistentStorage();
  try {
    const gameRoot = new URL(`games/${game}/`, document.baseURI);
    const manifestResponse = await fetch(new URL('manifest.json', gameRoot));
    if (!manifestResponse.ok) throw new Error('游戏资源尚未部署');
    const manifest = await manifestResponse.json();
    // These titles ship their music as bgm/*.mp3 plus a playlist rather than a
    // disc image.  That audio must not be downloaded here, but the player needs
    // its URLs, so send the same remote-load event the Kichikuou path uses.
    const allEntries = manifest.files.map((f) => {
      const entry = typeof f === 'string' ? {path: f, publicPath: f} : f;
      const url = new URL(entry.publicPath || entry.path, gameRoot);
      return {
        path: entry.path,
        url: url.href,
        version: typeof entry.sha256 === 'string' ? entry.sha256 : '',
        size: typeof entry.size === 'number' ? entry.size : 0,
      };
    });
    // Cached like the Kichikuou archives: the first visit stores every file, so
    // later visits only validate them.
    const wanted = allEntries.filter((entry) => !isUnusedStartFile(entry.path));
    const downloaded = await downloadGameFiles(wanted, status);
    const files = downloaded.map((blob, i) =>
      new File([blob], wanted[i].path.split('/').pop()));
    const bgm = await collectBgmTracks(allEntries);
    document.dispatchEvent(new CustomEvent('load-remote-files', {
      detail: {files, imageUrl: manifest.imageUrl || '', cueUrl: manifest.cueUrl || '',
               // Rance 4's Chinese scenario bytes are already UTF-8.  Converting
               // the archive back to GBK would shift its in-page jump addresses.
               // Keep the original bytes and select the engine's UTF-8 reader.
               // Only xsystem35 accepts this launcher flag. Rance 4.1/4.2
               // use system3.ini and reject `-encoding gbk` at startup.
               encoding: game === 'rance4' ? 'utf8' : undefined, bgm},
    }));
  } catch (error) {
    status.textContent = `加载失败：${error instanceof Error ? error.message : error}`;
    console.error(error);
  }
}

startSelectedGame();

