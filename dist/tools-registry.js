// 静态的攻略与工具目录。这里只描述已确认的入口状态，不伪造攻略内容或实时数据。
export const toolsRegistry = Object.freeze({
  rance4: {
    guide: {status: '待接入'},
    tools: {
      saveBackup: {status: '可在设置中使用'},
      modifier: {status: '待接入'},
    },
  },
  rance41: {
    guide: {status: '待接入'},
    tools: {
      saveBackup: {status: '可在设置中使用'},
      modifier: {status: '待接入'},
    },
  },
  rance42: {
    guide: {status: '待接入'},
    tools: {
      saveBackup: {status: '可在设置中使用'},
      modifier: {status: '待接入'},
    },
  },
  ranceking: {
    guide: {status: '远端发布状态：启动时检查游戏资源清单'},
    tools: {
      saveBackup: {status: '可在设置中使用'},
      modifier: {status: '待接入'},
    },
  },
});

export function renderToolsPanel(game) {
  const panel = document.querySelector('.guide-tools');
  const entry = toolsRegistry[game];
  if (!panel || !entry) return;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>攻略与工具</h2>
    <div class="guide-tools-grid">
      <div class="guide-tool-item"><strong>攻略</strong><span>${entry.guide.status}</span></div>
      <div class="guide-tool-item"><strong>存档备份</strong><span>${entry.tools.saveBackup.status}</span>
        <button class="btn btn-link guide-action" type="button" data-open-settings>打开设置</button>
      </div>
      <div class="guide-tool-item"><strong>修改器</strong><span>${entry.tools.modifier.status}</span></div>
    </div>
    <a class="btn" href="./">回到作品选择</a>`;
  const settingsButton = document.querySelector('#settings-button');
  panel.querySelector('[data-open-settings]')?.addEventListener('click', () => settingsButton?.click());
}
