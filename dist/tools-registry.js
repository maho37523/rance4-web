// 作品选择页上的「攻略与工具」入口。
//
// 真正的实现都在 shell.js 里（shell/guide.ts 的攻略阅读器、shell/trainer.ts 的
// 修改器），这里只负责把入口挂上去，并且只对兰斯 4 / 4.1 / 4.2 生效。
// 《鬼畜王兰斯》保持原状：状态文案不变，也不加任何新按钮。

export const toolsRegistry = Object.freeze({
  rance4: {
    guide: {
      status: '已接入：分章节中文攻略，游戏内在工具栏点「攻略」可读，并显示当前场景页',
      action: {label: '查看攻略', kind: 'guide'},
    },
    tools: {
      saveBackup: {status: '已接入：设置或修改器内可导出/恢复存档 ZIP'},
      modifier: {
        status: '已接入：运行期变量读写 + 数值搜索，游戏内在工具栏点「修改器」',
        action: {label: '打开修改器', kind: 'trainer'},
      },
    },
  },
  rance41: {
    guide: {
      status: '已接入：分章节中文攻略，游戏内在工具栏点「攻略」可读，并显示当前场景页',
      action: {label: '查看攻略', kind: 'guide'},
    },
    tools: {
      saveBackup: {status: '已接入：设置或修改器内可导出/恢复存档 ZIP'},
      modifier: {
        status: '已接入：运行期变量读写 + 数值搜索，游戏内在工具栏点「修改器」',
        action: {label: '打开修改器', kind: 'trainer'},
      },
    },
  },
  rance42: {
    guide: {
      status: '已接入：分章节中文攻略，游戏内在工具栏点「攻略」可读，并显示当前场景页',
      action: {label: '查看攻略', kind: 'guide'},
    },
    tools: {
      saveBackup: {status: '已接入：设置或修改器内可导出/恢复存档 ZIP'},
      modifier: {
        status: '已接入：运行期变量读写 + 数值搜索，游戏内在工具栏点「修改器」',
        action: {label: '打开修改器', kind: 'trainer'},
      },
    },
  },
  ranceking: {
    guide: {
      status: '已接入：基础游玩说明、存档与变量工具使用说明',
      action: {label: '查看攻略', kind: 'guide'},
    },
    tools: {
      saveBackup: {status: '可在设置中使用'},
      modifier: {
        status: '已接入：运行期变量查看、搜索与修改；改前请导出存档',
        action: {label: '打开修改器', kind: 'trainer'},
      },
    },
  },
});

function actionButton(action) {
  if (!action)
    return '';
  const attr = action.kind === 'guide' ? 'data-open-guide' : 'data-open-trainer';
  return `<button class="btn btn-sm guide-action" type="button" ${attr}>${action.label}</button>`;
}

export function renderToolsPanel(game) {
  const panel = document.querySelector('.guide-tools');
  const entry = toolsRegistry[game];
  if (!panel || !entry) return;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>攻略与工具</h2>
    <div class="guide-tools-grid">
      <div class="guide-tool-item"><strong>攻略</strong><span>${entry.guide.status}</span>
        ${actionButton(entry.guide.action)}
      </div>
      <div class="guide-tool-item"><strong>存档备份</strong><span>${entry.tools.saveBackup.status}</span>
        <button class="btn btn-sm btn-link guide-action" type="button" data-open-settings>打开设置</button>
      </div>
      <div class="guide-tool-item"><strong>修改器</strong><span>${entry.tools.modifier.status}</span>
        ${actionButton(entry.tools.modifier.action)}
      </div>
    </div>
    <a class="btn" href="./">回到作品选择</a>`;
  const settingsButton = document.querySelector('#settings-button');
  panel.querySelector('[data-open-settings]')?.addEventListener('click', () => settingsButton?.click());
  panel.querySelector('[data-open-guide]')?.addEventListener('click', () => {
    if (window.ranceGuide)
      window.ranceGuide.open(game);
    else
      alert('攻略模块尚未加载完成，请等页面加载完毕后重试，或在游戏中点击工具栏的「攻略」。');
  });
  panel.querySelector('[data-open-trainer]')?.addEventListener('click', () => {
    if (window.ranceTrainer)
      window.ranceTrainer.open();
    else
      alert('修改器模块尚未加载完成，请等页面加载完毕后再试。');
  });
}
