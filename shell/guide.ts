// Walkthrough (攻略) viewer.
//
// The guide content lives in ./guides/*.ts as plain data so it is reviewable
// and diffable.  Each section may carry the scenario page numbers it covers;
// when a game is running the panel reads the interpreter's current page and
// marks where the player is, which is the cheap half of "progress-aware".
import {$, urlParams} from './util.js';
import {guides, Guide, GuideSection} from './guides/index.js';
import {noteUi} from './diagnostics.js';

export type GuideGame = 'rance4' | 'rance41' | 'rance42' | 'ranceking';

function currentGame(): GuideGame | null {
    const game = urlParams.get('game');
    return game === 'rance4' || game === 'rance41' || game === 'rance42' || game === 'ranceking' ? game : null;
}

function currentPage(): number | null {
    const m = window.Module as any;
    if (!m || typeof m._cheat_page !== 'function')
        return null;
    try {
        const page = m._cheat_page();
        return page >= 0 ? page : null;
    } catch (e) {
        return null;
    }
}

class GuidePanel {
    private dialog: HTMLDialogElement;
    private nav: HTMLElement;
    private content: HTMLElement;
    private titleEl: HTMLElement;
    private progressEl: HTMLElement;
    private picker: HTMLSelectElement;
    private game: GuideGame | null = null;
    private activeSection = 0;
    private progressTimer: number | undefined;

    constructor() {
        this.dialog = document.createElement('dialog');
        this.dialog.id = 'guide';
        this.dialog.className = 'modal-container guide';
        this.dialog.innerHTML = `
            <div class="modal-header">
              <div class="modal-title guide-title"></div>
            </div>
            <div class="guide-toolbar">
              <select class="form-select guide-picker"></select>
              <span class="guide-progress"></span>
            </div>
            <div class="modal-body guide-body">
              <nav class="guide-nav"></nav>
              <article class="guide-content"></article>
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary guide-close" type="button">关闭</button>
            </div>`;
        document.body.appendChild(this.dialog);

        this.nav = this.dialog.querySelector('.guide-nav')!;
        this.content = this.dialog.querySelector('.guide-content')!;
        this.titleEl = this.dialog.querySelector('.guide-title')!;
        this.progressEl = this.dialog.querySelector('.guide-progress')!;
        this.picker = this.dialog.querySelector('.guide-picker')! as HTMLSelectElement;

        for (const [id, guide] of Object.entries(guides))
            this.picker.append(new Option(guide.title, id));
        this.picker.addEventListener('change', () => this.show(this.picker.value as GuideGame));

        this.dialog.querySelector('.guide-close')!.addEventListener('click', () => this.dialog.close());
        this.dialog.addEventListener('close', () => this.onClose());
        this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
        for (const child of Array.from(this.dialog.children))
            child.addEventListener('click', (e) => e.stopPropagation());
    }

    open(game?: GuideGame | null) {
        const target = game ?? this.game ?? currentGame() ?? 'rance4';
        this.show(target);
        this.dialog.showModal();
        this.startProgress();
    }

    private show(game: GuideGame) {
        const guide: Guide | undefined = guides[game];
        if (!guide)
            return;
        this.game = game;
        this.picker.value = game;
        this.titleEl.textContent = guide.title;
        this.activeSection = 0;
        this.renderNav(guide);
        this.renderContent(guide);
        this.updateProgress();
    }

    private renderNav(guide: Guide) {
        this.nav.textContent = '';
        guide.sections.forEach((section, index) => {
            const link = document.createElement('a');
            link.href = 'javascript:void(0)';
            link.textContent = section.title;
            link.className = 'guide-nav-item';
            link.dataset.index = String(index);
            if (this.isDone(section.title))
                link.classList.add('done');
            link.addEventListener('click', () => {
                this.activeSection = index;
                this.renderContent(guide);
            });
            this.nav.append(link);
        });
    }

    // Manual progress tracking.  There is no verified scenario-page map for
    // every step, so instead of inventing one the reader ticks sections off and
    // the state is kept per game in localStorage.
    private progressKey(game: GuideGame): string {
        return `rance-guide-progress:${game}`;
    }

    private completedSet(game: GuideGame): Set<string> {
        try {
            const raw = localStorage.getItem(this.progressKey(game));
            return new Set<string>(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set<string>();
        }
    }

    private saveCompleted(game: GuideGame, done: Set<string>) {
        try {
            localStorage.setItem(this.progressKey(game), JSON.stringify([...done]));
        } catch (e) {
            // Progress is a convenience; a storage failure must not break the guide.
        }
    }

    private isDone(title: string): boolean {
        return this.game ? this.completedSet(this.game).has(title) : false;
    }

    private toggleDone(title: string) {
        if (!this.game)
            return;
        const done = this.completedSet(this.game);
        if (done.has(title))
            done.delete(title);
        else
            done.add(title);
        this.saveCompleted(this.game, done);
        const guide = guides[this.game];
        this.renderNav(guide);
        this.renderContent(guide);
        this.updateProgress();
    }

    private renderContent(guide: Guide) {
        const section: GuideSection | undefined = guide.sections[this.activeSection];
        this.content.textContent = '';
        if (!section)
            return;
        for (const item of this.nav.querySelectorAll('.guide-nav-item'))
            item.classList.toggle('active', Number((item as HTMLElement).dataset.index) === this.activeSection);

        this.content.append(element('h2', section.title));
        if (section.summary)
            this.content.append(element('p', {class: 'guide-summary'}, section.summary));
        if (section.pages && section.pages.length > 0)
            this.content.append(element('p', {class: 'guide-pages'},
                `对应场景页：${section.pages.join(', ')}`));

        for (const block of section.blocks) {
            switch (block.kind) {
                case 'p':
                    this.content.append(element('p', block.text));
                    break;
                case 'note':
                    this.content.append(element('p', {class: 'guide-note'}, block.text));
                    break;
                case 'list': {
                    const ul = document.createElement('ul');
                    for (const entry of block.items)
                        ul.append(element('li', entry));
                    this.content.append(ul);
                    break;
                }
                case 'steps': {
                    const ol = document.createElement('ol');
                    for (const entry of block.items)
                        ol.append(element('li', entry));
                    this.content.append(ol);
                    break;
                }
                case 'table': {
                    const table = document.createElement('table');
                    table.className = 'table guide-table';
                    const thead = document.createElement('thead');
                    const headRow = document.createElement('tr');
                    for (const cell of block.head)
                        headRow.append(element('th', cell));
                    thead.append(headRow);
                    table.append(thead);
                    const tbody = document.createElement('tbody');
                    for (const row of block.rows) {
                        const tr = document.createElement('tr');
                        for (const cell of row)
                            tr.append(element('td', cell));
                        tbody.append(tr);
                    }
                    table.append(tbody);
                    this.content.append(table);
                    break;
                }
            }
        }

        const done = this.isDone(section.title);
        const mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'btn btn-sm guide-done';
        mark.textContent = done ? '✓ 已完成本章（点击取消）' : '标记本章为已完成';
        mark.addEventListener('click', () => this.toggleDone(section.title));
        const actions = document.createElement('div');
        actions.className = 'guide-actions';
        actions.append(mark);
        this.content.append(actions);

        this.content.append(element('h3', '资料来源'));
        const sources = document.createElement('ul');
        sources.className = 'guide-sources';
        for (const source of guide.sources) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = source.url;
            a.target = '_blank';
            a.rel = 'noreferrer noopener';
            a.textContent = source.label;
            li.append(a);
            sources.append(li);
        }
        this.content.append(sources);
        this.content.scrollTop = 0;
    }

    private startProgress() {
        this.stopProgress();
        this.progressTimer = window.setInterval(() => this.updateProgress(), 1000);
    }

    private stopProgress() {
        if (this.progressTimer !== undefined) {
            window.clearInterval(this.progressTimer);
            this.progressTimer = undefined;
        }
    }

    private updateProgress() {
        const guide = this.game ? guides[this.game] : undefined;
        if (!guide)
            return;
        const done = this.game ? this.completedSet(this.game) : new Set<string>();
        const doneCount = guide.sections.filter((s) => done.has(s.title)).length;
        const progress = `攻略进度 ${doneCount}/${guide.sections.length}`;
        const page = currentPage();
        if (page === null) {
            this.progressEl.textContent = `${progress} · 未检测到运行中的游戏，仅显示静态攻略。`;
            return;
        }
        const index = guide.sections.findIndex((s) => s.pages?.includes(page));
        if (index >= 0) {
            const section = guide.sections[index];
            this.progressEl.textContent = `${progress} · 当前场景页 ${page} → 对应「${section.title}」`;
            const link = this.nav.querySelector(`.guide-nav-item[data-index="${index}"]`);
            if (link && !link.classList.contains('current')) {
                this.nav.querySelectorAll('.guide-nav-item').forEach((e) => e.classList.remove('current'));
                link.classList.add('current');
            }
        } else {
            this.progressEl.textContent = `${progress} · 当前场景页 ${page}（本攻略按流程分章，未绑定页号）`;
        }
    }

    private onClose() {
        this.stopProgress();
    }
}

function element(tag: string, attrsOrText?: Record<string, string> | string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    if (typeof attrsOrText === 'string') {
        e.textContent = attrsOrText;
        return e;
    }
    if (attrsOrText) {
        for (const [key, value] of Object.entries(attrsOrText)) {
            if (key === 'class')
                e.className = value;
            else
                e.setAttribute(key, value);
        }
    }
    if (text !== undefined)
        e.textContent = text;
    return e;
}

let panel: GuidePanel | null = null;

export function openGuide(game?: GuideGame | null) {
    if (!panel)
        panel = new GuidePanel();
    // On the timeline so a hang right after opening the walkthrough is legible.
    noteUi(`攻略面板打开${game ? ` (${game})` : ''}`);
    panel.open(game);
}

function installToolbarButton() {
    const game = currentGame();
    if (!game || $('#guide-button'))
        return;
    const button = document.createElement('button');
    button.id = 'guide-button';
    button.type = 'button';
    button.className = 'btn btn-link tooltip tooltip-bottom mr-2 hidden-until-game-start';
    button.dataset.tooltip = '攻略';
    const icon = document.createElement('i');
    icon.className = 'fa fa-book';
    button.append(icon);
    button.addEventListener('click', () => { openGuide(); button.blur(); });
    const anchor = $('#settings-button');
    anchor.parentElement!.insertBefore(button, anchor);
}

export function initGuide() {
    if (!currentGame())
        return;
    installToolbarButton();
    (window as any).ranceGuide = {open: openGuide};
}
