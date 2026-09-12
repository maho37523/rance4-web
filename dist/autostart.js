const games = {
  rance4: '兰斯 4－教团的遗产－',
  rance41: '兰斯 4.1 ～拯救制药厂！～',
  rance42: '兰斯 4.2 ～天使组～',
};

async function startSelectedGame() {
  const game = new URLSearchParams(location.search).get('game');
  if (!game || !games[game]) return;
  document.title = `${games[game]} · Rance Web`;
  document.querySelector('.navbar-brand').textContent = games[game];
  document.querySelector('#loader h1').textContent = games[game];
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
