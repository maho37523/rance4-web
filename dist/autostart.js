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

async function startSelectedGame() {
  const game = new URLSearchParams(location.search).get('game');
  if (!game || !games[game]) return;
  if (games[game].resourceStrategy === 'local-import') {
    showLocalImport(game);
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
    for (let i = 0; i < manifest.files.length; i++) {
      const entry = typeof manifest.files[i] === 'string'
        ? {path: manifest.files[i], publicPath: manifest.files[i]}
        : manifest.files[i];
      const path = entry.path;
      const publicPath = entry.publicPath || path;
      status.textContent = `正在加载原始游戏文件：${i + 1} / ${manifest.files.length}`;
      const url = new URL(publicPath.split('/').map(encodeURIComponent).join('/'), gameRoot);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`无法读取 ${path}`);
      files.push(new File([await response.blob()], path.split('/').pop()));
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
