import type {Guide} from './types.js';

// This is deliberately a verified in-app companion, not a fabricated full
// route map. Scenario page numbers vary between releases, so progress is
// manual until a release-specific map has been checked against this archive.
export const ranceking: Guide = {
    title: '鬼畜王兰斯：游玩与工具指南',
    engine: 'xsystem35',
    overview: '提供浏览器版的开局操作、存档保护、音乐排障和变量修改器使用方法。流程进度可在左侧逐项勾选；不会依据不可靠的页号猜测剧情位置。',
    sections: [
        {
            title: '开始前：横屏、网络与存档',
            blocks: [
                {kind: 'steps', items: [
                    '手机请横屏进入；A 为确认，B 短按为返回，长按为快进，方向键用于菜单选择。',
                    '首次加载需要下载游戏数据；进度不动时确认代理/网络可访问资源，再刷新重试。',
                    '开始修改前，先在“设置”导出存档 ZIP；存档与浏览器站点数据绑定。',
                ]},
                {kind: 'note', text: '背景音乐按场景按需读取 CD 镜像；音效正常但音乐没有时，等待网络恢复后重新进入触发该曲目的场景。'},
            ],
        },
        {
            title: '修改器：安全使用',
            blocks: [
                {kind: 'steps', items: [
                    '游戏运行后点工具栏“修改器”，先在变量页观察当前非零变量。',
                    '不清楚变量含义时用“搜索”：记录数值变化前后，筛选结果，再只修改单个候选值。',
                    '一次只改一个数值，立刻回到游戏验证；遇到剧情异常，用之前导出的 ZIP 恢复。',
                ]},
                {kind: 'note', text: '修改器直接读写引擎变量，不会修改游戏文件；它不能替代正常存档，也不保证任意变量都适合编辑。'},
            ],
        },
        {
            title: '游玩排障',
            blocks: [
                {kind: 'list', items: [
                    '画面或按钮失灵：旋转一次屏幕，或刷新后重新进入游戏。',
                    '音乐加载失败：检查网络后重新触发当前场景；页面会显示具体提示。',
                    '需要回退：短按 B；需要跳过已读文字：长按 B。',
                    '出现异常：导出存档并记录画面、当前章节和浏览器版本，避免覆盖原进度。',
                ]},
            ],
        },
    ],
    sources: [],
};
