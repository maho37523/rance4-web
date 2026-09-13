import {renderToolsPanel} from './tools-registry.js';

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
      return {path: item.path, url: resolve(urlValue)};
    });
    return {files, imageUrl: resolve(manifest.imageUrl).href, cueUrl: resolve(manifest.cueUrl).href};
  } catch (error) {
    throw error instanceof Error ? error : new Error('发布清单 URL 无效');
  }
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
async function fetchGameFile(url, label) {
  let total = 0;
  try {
    const head = await fetch(url, {headers: {Range: 'bytes=0-0'}});
    if (head.status === 206) {
      const m = /^bytes \d+-\d+\/(\d+)$/.exec(head.headers.get('Content-Range') || '');
      if (m) total = Number(m[1]);
    }
  } catch {}
  if (!total) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法读取 ${label}`);
    return await res.blob();
  }
  const chunk = 4 << 20;
  const parts = [];
  for (let offset = 0; offset < total; offset += chunk) {
    const end = Math.min(offset + chunk, total) - 1;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {headers: {Range: `bytes=${offset}-${end}`}});
        if (res.status !== 206) throw new Error(`status ${res.status}`);
        const blob = await res.blob();
        if (blob.size !== end - offset + 1) throw new Error(`short chunk ${blob.size}`);
        parts.push(blob);
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
        if (attempt === 4) throw new Error(`无法读取 ${label}：${e.message}`);
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
    if (lastError) throw new Error(`无法读取 ${label}`);
  }
  return new Blob(parts);
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
    const files = [];
    // Audio is never handed to the interpreters as game data: the runtime
    // either streams CD tracks from the disc image or reads BGM from an ALD.
    // Fetching it anyway made a published Rance 4 start transfer 82 MB of the
    // 106 MB payload before the title screen, which never finished on mobile.
    const downloadable = remote.files.filter((entry) => !isUnusedStartFile(entry.path));
    for (let i = 0; i < downloadable.length; i++) {
      const entry = downloadable[i];
      status.textContent = `正在加载原始游戏文件：${i + 1} / ${downloadable.length}`;
      files.push(new File([await fetchGameFile(entry.url, entry.path)], entry.path.split('/').pop()));
    }
    document.dispatchEvent(new CustomEvent('load-remote-files', {
      detail: {files, imageUrl: remote.imageUrl, cueUrl: remote.cueUrl, encoding: 'gbk'},
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
  try {
    const gameRoot = new URL(`games/${game}/`, document.baseURI);
    const manifestResponse = await fetch(new URL('manifest.json', gameRoot));
    if (!manifestResponse.ok) throw new Error('游戏资源尚未部署');
    const manifest = await manifestResponse.json();
    const files = [];
    const wanted = manifest.files
      .map((f) => typeof f === 'string' ? {path: f, publicPath: f} : f)
      .filter((entry) => !isUnusedStartFile(entry.path));
    for (let i = 0; i < wanted.length; i++) {
      const entry = wanted[i];
      const path = entry.path;
      const publicPath = entry.publicPath || path;
      status.textContent = `正在加载原始游戏文件：${i + 1} / ${wanted.length}`;
      const url = new URL(publicPath.split('/').map(encodeURIComponent).join('/'), gameRoot);
      files.push(new File([await fetchGameFile(url, path)], path.split('/').pop()));
    }
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const input = document.querySelector('#fileselect');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    status.textContent = `加载失败：${error instanceof Error ? error.message : error}`;
    console.error(error);
  }
}

startSelectedGame();
