// Trainer (修改器) bridge and UI.
//
// Two halves:
//   1. TrainerEngine wraps the `cheat_*` functions that the C++ interpreters
//      export.  They read and write the script variables the VM already owns,
//      which is how "memory injection" works here: no byte pattern scanning,
//      the engine hands out the real variable table.
//   2. TrainerPanel is the dialog.  It never runs unless the launcher selected
//      one of the three supported games, so any other launch (including
//      鬼畜王兰斯) behaves exactly as before.
import {$, urlParams} from './util.js';
import {addToast, openFileInput} from './widgets.js';
import {SaveDataManager} from './savedata.js';
import {getPresets} from './cheat-presets.js';
import type {Preset} from './cheat-presets.js';

export type SupportedGame = 'rance4' | 'rance41' | 'rance42' | 'ranceking';

const supportedGames: SupportedGame[] = ['rance4', 'rance41', 'rance42', 'ranceking'];

// The trainer is opt-in per game: the launcher must have asked for one of the
// three titles above.
export function activeGame(): SupportedGame | null {
    const game = urlParams.get('game');
    return supportedGames.includes(game as SupportedGame) ? game as SupportedGame : null;
}

type EmscriptenModule = {
    HEAPU8: Uint8Array;
    stringToUTF8OnStack(str: string): number;
    _cheat_engine_id(): number;
    _cheat_page(): number;
    _cheat_addr(): number;
    _cheat_var_count(): number;
    _cheat_var_ptr(): number;
    _cheat_get_var(index: number): number;
    _cheat_set_var(index: number, value: number): number;
    _cheat_var_name(index: number): number;
    _cheat_strvar_count(): number;
    _cheat_get_strvar(index: number): number;
    _cheat_set_strvar(index: number, utf8: number): number;
    _cheat_page_count(): number;
    _cheat_page_size(page: number): number;
    _cheat_page_saveflag(page: number): number;
    _cheat_page_ptr(page: number): number;
    _cheat_get_page_var(page: number, index: number): number;
    _cheat_set_page_var(page: number, index: number, value: number): number;
    _cheat_longvar_count(): number;
    _cheat_get_longvar(index: number): number;
    _cheat_set_longvar(index: number, value: number): number;
};

function getModule(): EmscriptenModule | null {
    const m = window.Module as unknown as EmscriptenModule | undefined;
    if (!m || typeof m._cheat_var_count !== 'function')
        return null;
    return m;
}

export class TrainerEngine {
    constructor(private m: EmscriptenModule) {}

    get kind(): 'xsystem35' | 'system3' {
        return this.m._cheat_engine_id() === 2 ? 'system3' : 'xsystem35';
    }

    get supportsArrays(): boolean {
        return this.m._cheat_page_count() > 0;
    }

    get supportsLongVars(): boolean {
        return this.m._cheat_longvar_count() > 0;
    }

    page(): number { return this.m._cheat_page(); }
    addr(): number { return this.m._cheat_addr(); }

    varCount(): number { return this.m._cheat_var_count(); }

    // Live view of the whole variable table.  Recreated on every call because
    // growing the wasm heap detaches the previous ArrayBuffer.
    varView(): Uint16Array {
        const count = this.varCount();
        const ptr = this.m._cheat_var_ptr();
        if (ptr <= 0 || count <= 0)
            return new Uint16Array(0);
        return new Uint16Array(this.m.HEAPU8.buffer, ptr, count);
    }

    getVar(index: number): number { return this.m._cheat_get_var(index); }
    setVar(index: number, value: number): number { return this.m._cheat_set_var(index, value); }
    varName(index: number): string { return readCString(this.m, this.m._cheat_var_name(index)); }

    strVarCount(): number { return this.m._cheat_strvar_count(); }
    getStrVar(index: number): string { return readCString(this.m, this.m._cheat_get_strvar(index)); }
    setStrVar(index: number, value: string): void {
        this.m._cheat_set_strvar(index, this.m.stringToUTF8OnStack(value));
    }

    pageCount(): number { return this.m._cheat_page_count(); }
    pageSize(page: number): number { return this.m._cheat_page_size(page); }
    pageSaveFlag(page: number): number { return this.m._cheat_page_saveflag(page); }

    pageView(page: number, size: number): Uint16Array {
        const ptr = this.m._cheat_page_ptr(page);
        if (ptr <= 0 || size <= 0)
            return new Uint16Array(0);
        return new Uint16Array(this.m.HEAPU8.buffer, ptr, size);
    }

    getPageVar(page: number, index: number): number { return this.m._cheat_get_page_var(page, index); }
    setPageVar(page: number, index: number, value: number): number {
        return this.m._cheat_set_page_var(page, index, value);
    }

    longVarCount(): number { return this.m._cheat_longvar_count(); }
    getLongVar(index: number): number { return this.m._cheat_get_longvar(index); }
    setLongVar(index: number, value: number): void { this.m._cheat_set_longvar(index, value); }
}

// UTF8ToString is not in EXPORTED_RUNTIME_METHODS for either engine, so decode
// the C string ourselves.  TextDecoder handles the GBK->UTF-8 conversion done
// on the C side.
const utf8Decoder = new TextDecoder('utf-8');
function readCString(m: EmscriptenModule, ptr: number): string {
    if (!ptr)
        return '';
    const heap = m.HEAPU8;
    let end = ptr;
    while (heap[end])
        end++;
    return utf8Decoder.decode(heap.subarray(ptr, end));
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {},
                                                  ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined)
            continue;
        if (key === 'class')
            e.className = String(value);
        else if (key === 'text')
            e.textContent = String(value);
        else if (key.startsWith('on') && typeof value === 'function')
            e.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        else
            e.setAttribute(key, String(value));
    }
    for (const child of children)
        e.append(child);
    return e;
}

// ---------------------------------------------------------------------------
// Trainer dialog
// ---------------------------------------------------------------------------

type Lock = { kind: 'var' | 'page' | 'long' | 'str'; page?: number; index: number; value: number | string };

class TrainerPanel {
    private dialog: HTMLDialogElement;
    private statusEl: HTMLElement;
    private panels = new Map<string, HTMLElement>();
    private tabButtons = new Map<string, HTMLElement>();
    private engine: TrainerEngine | null = null;
    private game: SupportedGame;
    private saveDataManager: SaveDataManager | null = null;

    // variable table state
    private varFilter = '';
    private varNonZeroOnly = true;
    private varPage = 0;
    private varRowsPerPage = 200;
    private varTableBody!: HTMLElement;
    private varSummary!: HTMLElement;
    private varFilterInput!: HTMLInputElement;
    private liveTimer: number | undefined;

    // search state
    private candidates: number[] = [];
    private searchKnown = new Map<number, number>();
    private searchValueInput!: HTMLInputElement;
    private searchOpSelect!: HTMLSelectElement;
    private searchResultsEl!: HTMLElement;
    private searchSummary!: HTMLElement;
    private writeValueInput!: HTMLInputElement;

    private locks = new Map<string, Lock>();
    private lockTimer: number | undefined;
    private originalValues = new Map<string, number | string>();

    constructor(game: SupportedGame) {
        this.game = game;
        this.dialog = this.buildDialog();
        document.body.appendChild(this.dialog);
        this.statusEl = this.dialog.querySelector('.trainer-status')!;
        this.dialog.querySelector('#trainer-close')!.addEventListener('click', () => this.dialog.close());
        this.dialog.addEventListener('close', () => this.onClose());
        this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
        for (const child of Array.from(this.dialog.children))
            child.addEventListener('click', (e) => e.stopPropagation());
    }

    private buildDialog(): HTMLDialogElement {
        const dialog = h('dialog', {id: 'trainer', class: 'modal-container trainer'}) as HTMLDialogElement;

        const tabs = h('ul', {class: 'tab tab-block trainer-tabs'});
        this.makeTab(tabs, 'common', '常用修改', () => this.renderCommon());
        this.makeTab(tabs, 'vars', '变量浏览', () => this.renderVars());
        this.makeTab(tabs, 'search', '数值搜索', () => this.renderSearch());
        this.makeTab(tabs, 'save', '存档备份', () => this.renderSave());

        const body = h('div', {class: 'modal-body trainer-body'}, tabs);
        const panelNames: [string, string][] = [
            ['common', '常用修改'], ['vars', '变量浏览'], ['search', '数值搜索'], ['save', '存档备份'],
        ];
        for (const [name, title] of panelNames) {
            const panel = h('section', {class: 'trainer-panel', 'data-panel': name, 'aria-label': title});
            panel.hidden = name !== 'common';
            this.panels.set(name, panel);
            body.append(panel);
        }

        dialog.append(
            h('div', {class: 'modal-header'},
              h('div', {class: 'modal-title'}, '修改器',
                h('span', {class: 'trainer-engine-label ml-2'}))),
            h('div', {class: 'trainer-status'}),
            body,
            h('div', {class: 'modal-footer'},
              h('button', {id: 'trainer-close', class: 'btn btn-primary', type: 'button'}, '关闭')),
        );
        return dialog;
    }

    private makeTab(container: HTMLElement, name: string, label: string, onSelect: () => void) {
        const item = h('li', {class: 'tab-item'});
        const link = h('a', {href: 'javascript:void(0)', text: label});
        link.addEventListener('click', () => {
            for (const [key, panel] of this.panels)
                panel.hidden = key !== name;
            for (const [key, button] of this.tabButtons)
                button.classList.toggle('active', key === name);
            this.stopLiveRefresh();
            onSelect();
        });
        item.append(link);
        this.tabButtons.set(name, item);
        container.append(item);
    }

    open() {
        this.engine = getModule() ? new TrainerEngine(getModule()!) : null;
        if (!this.engine) {
            addToast('游戏尚未启动，无法打开修改器', 'warning');
            return;
        }
        this.statusEl.textContent =
            `引擎 ${this.engine.kind} · 当前页 ${this.engine.page()} · 地址 0x${this.engine.addr().toString(16)}`;
        this.dialog.querySelector('.trainer-engine-label')!.textContent =
            this.engine.kind === 'system3' ? '（System 3 运行期内存）' : '（xsystem35 运行期内存）';
        this.dialog.appendChild($('#toast-container'));
        this.dialog.showModal();
        // Show whichever tab is currently selected.
        const active = Array.from(this.tabButtons.entries()).find(([, e]) => e.classList.contains('active'));
        this.selectTab(active ? active[0] : 'common');
    }

    private selectTab(name: string) {
        for (const [key, panel] of this.panels)
            panel.hidden = key !== name;
        for (const [key, button] of this.tabButtons)
            button.classList.toggle('active', key === name);
        this.stopLiveRefresh();
        if (name === 'common') this.renderCommon();
        else if (name === 'vars') this.renderVars();
        else if (name === 'search') this.renderSearch();
        else if (name === 'save') this.renderSave();
    }

    private onClose() {
        this.stopLiveRefresh();
        this.locks.clear();
        document.body.appendChild($('#toast-container'));
    }

    private stopLiveRefresh() {
        if (this.liveTimer !== undefined) {
            window.clearInterval(this.liveTimer);
            this.liveTimer = undefined;
        }
    }

    // -- 常用修改 -----------------------------------------------------------

    private renderCommon() {
        const engine = this.engine!;
        const panel = this.panels.get('common')!;
        panel.textContent = '';

        panel.append(h('p', {class: 'trainer-hint'},
            '这些是已核对过的固定地址。其余数值请用「数值搜索」定位：' +
            '先在游戏里记住当前数字，扫描一次，然后让数字变化，再扫描一次。'));

        const presets = getPresets(this.game, engine.kind);
        if (presets.length === 0) {
            panel.append(h('p', {class: 'trainer-empty'},
                '本作暂无已核对的固定修改项。请使用「数值搜索」页手动定位。'));
        } else {
            const table = h('table', {class: 'table trainer-table'});
            table.append(h('thead', {}, h('tr', {},
                h('th', {text: '项目'}),
                h('th', {text: '变量'}),
                h('th', {text: '当前值'}),
                h('th', {text: '设为'}),
                h('th', {text: '锁定'}),
            )));
            const tbody = h('tbody');
            for (const preset of presets)
                tbody.append(this.buildPresetRow(engine, preset));
            table.append(tbody);
            panel.append(table);
        }

        if (engine.supportsArrays) {
            panel.append(h('h5', {class: 'mt-2'}, '数组页（角色/道具数据）'));
            panel.append(h('p', {class: 'trainer-hint'},
                '兰斯 4 把角色和道具数据放在数组页里，而不是系统变量中。展开下面的列表可以读写。'));
            panel.append(this.buildPageExplorer(engine));
        }

        if (this.originalValues.size > 0) {
            const restore = h('button', {class: 'btn', type: 'button'}, `还原全部改动（${this.originalValues.size}）`);
            restore.addEventListener('click', () => {
                for (const [key, value] of this.originalValues) {
                    const [kind, a, b] = key.split(':');
                    if (kind === 'var') engine.setVar(Number(a), Number(value));
                    else if (kind === 'page') engine.setPageVar(Number(a), Number(b), Number(value));
                    else if (kind === 'long') engine.setLongVar(Number(a), Number(value));
                    else if (kind === 'str') engine.setStrVar(Number(a), String(value));
                }
                this.originalValues.clear();
                addToast('已还原本次会话中修改过的数值', 'success');
                this.renderCommon();
            });
            panel.append(h('div', {class: 'trainer-actions'}, restore));
        }
    }

    private buildPresetRow(engine: TrainerEngine, preset: Preset): HTMLElement {
        const valueCell = h('span', {class: 'trainer-value', text: String(engine.getVar(preset.index))});
        const input = h('input', {type: 'number', class: 'form-input trainer-set-input', min: 0, max: 65535}) as HTMLInputElement;
        input.value = String(preset.suggested ?? engine.getVar(preset.index));

        const apply = (value: number) => {
            const key = `var:${preset.index}`;
            if (!this.originalValues.has(key))
                this.originalValues.set(key, engine.getVar(preset.index));
            const result = engine.setVar(preset.index, value);
            valueCell.textContent = String(result);
            input.value = String(result);
        };

        const minus = h('button', {class: 'btn btn-sm', type: 'button'}, '−');
        minus.addEventListener('click', () => apply(Math.max(0, engine.getVar(preset.index) - (preset.step ?? 1))));
        const plus = h('button', {class: 'btn btn-sm', type: 'button'}, '＋');
        plus.addEventListener('click', () => apply(Math.min(65535, engine.getVar(preset.index) + (preset.step ?? 1))));
        const setButton = h('button', {class: 'btn btn-sm btn-primary', type: 'button'}, '写入');
        setButton.addEventListener('click', () => apply(Number(input.value) || 0));

        const lockBox = h('input', {type: 'checkbox'}) as HTMLInputElement;
        lockBox.addEventListener('change', () => {
            const key = `var:${preset.index}`;
            if (lockBox.checked)
                this.locks.set(key, {kind: 'var', index: preset.index, value: Number(input.value) || 0});
            else
                this.locks.delete(key);
            this.ensureLockTimer();
        });

        return h('tr', {},
            h('td', {}, h('div', {text: preset.label}),
                preset.note ? h('small', {class: 'trainer-note', text: preset.note}) : ''),
            h('td', {class: 'trainer-mono', text: preset.varLabel ?? `VAR${preset.index}`}),
            h('td', {}, valueCell),
            h('td', {}, h('div', {class: 'trainer-inline'}, minus, input, plus, setButton)),
            h('td', {}, lockBox),
        );
    }

    private buildPageExplorer(engine: TrainerEngine): HTMLElement {
        const detail = h('div', {class: 'trainer-pages'});
        detail.hidden = true;
        const toggle = h('button', {class: 'btn btn-sm', type: 'button'}, '展开数组页');
        toggle.addEventListener('click', () => {
            detail.hidden = !detail.hidden;
            toggle.textContent = detail.hidden ? '展开数组页' : '收起数组页';
            if (!detail.hidden && detail.childElementCount === 0)
                this.fillPageExplorer(engine, detail);
        });
        return h('div', {}, toggle, detail);
    }

    private fillPageExplorer(engine: TrainerEngine, container: HTMLElement) {
        let any = false;
        for (let page = 1; page < engine.pageCount(); page++) {
            const size = engine.pageSize(page);
            if (size <= 0)
                continue;
            any = true;
            const saveFlag = engine.pageSaveFlag(page) ? '存档保存' : '不存档';
            const block = h('details', {class: 'trainer-page-block'},
                h('summary', {}, `页 ${page} · ${size} 项 · ${saveFlag}`));
            const list = h('div', {class: 'trainer-page-items'});
            const shown = Math.min(size, 128);
            for (let i = 0; i < shown; i++) {
                const index = i;
                const input = h('input', {type: 'number', class: 'form-input trainer-page-input', min: 0, max: 65535}) as HTMLInputElement;
                input.value = String(engine.getPageVar(page, index));
                input.addEventListener('change', () => {
                    const key = `page:${page}:${index}`;
                    if (!this.originalValues.has(key))
                        this.originalValues.set(key, engine.getPageVar(page, index));
                    engine.setPageVar(page, index, Number(input.value) || 0);
                });
                list.append(h('label', {class: 'trainer-page-item'},
                    h('span', {class: 'trainer-mono', text: `[${index}]`}), input));
            }
            if (size > shown)
                list.append(h('p', {class: 'trainer-hint', text: `仅显示前 ${shown} 项（共 ${size} 项）`}));
            block.append(list);
            container.append(block);
        }
        if (!any)
            container.append(h('p', {class: 'trainer-hint', text: '当前没有已分配的数组页。'}));
    }

    // -- 变量浏览 -----------------------------------------------------------

    private renderVars() {
        const engine = this.engine!;
        const panel = this.panels.get('vars')!;
        panel.textContent = '';

        this.varFilterInput = h('input', {type: 'search', class: 'form-input', placeholder: '按变量名/编号筛选，例如 金钱 或 353'}) as HTMLInputElement;
        this.varFilterInput.value = this.varFilter;
        this.varFilterInput.addEventListener('input', () => {
            this.varFilter = this.varFilterInput.value.trim();
            this.varPage = 0;
            this.updateVarTable();
        });

        const nonZero = h('input', {type: 'checkbox'}) as HTMLInputElement;
        nonZero.checked = this.varNonZeroOnly;
        nonZero.addEventListener('change', () => {
            this.varNonZeroOnly = nonZero.checked;
            this.varPage = 0;
            this.updateVarTable();
        });

        const live = h('input', {type: 'checkbox'}) as HTMLInputElement;
        live.addEventListener('change', () => {
            if (live.checked)
                this.liveTimer = window.setInterval(() => this.updateVarTable(), 500);
            else
                this.stopLiveRefresh();
        });

        this.varSummary = h('span', {class: 'trainer-summary'});

        panel.append(
            h('div', {class: 'trainer-toolbar'},
              this.varFilterInput,
              h('label', {class: 'form-checkbox trainer-inline'}, nonZero, h('i', {class: 'form-icon'}), '只显示非零'),
              h('label', {class: 'form-checkbox trainer-inline'}, live, h('i', {class: 'form-icon'}), '实时刷新'),
              this.varSummary),
        );

        const table = h('table', {class: 'table trainer-table trainer-var-table'});
        table.append(h('thead', {}, h('tr', {},
            h('th', {text: '编号'}), h('th', {text: '名称'}), h('th', {text: '值'}), h('th', {text: '锁定'}))));
        this.varTableBody = h('tbody');
        table.append(this.varTableBody);
        panel.append(table);

        const prev = h('button', {class: 'btn btn-sm', type: 'button'}, '上一页');
        prev.addEventListener('click', () => { if (this.varPage > 0) { this.varPage--; this.updateVarTable(); } });
        const next = h('button', {class: 'btn btn-sm', type: 'button'}, '下一页');
        next.addEventListener('click', () => { this.varPage++; this.updateVarTable(); });
        panel.append(h('div', {class: 'trainer-actions'}, prev, next));

        panel.append(h('h5', {class: 'mt-2'}, '字符串变量'));
        panel.append(this.buildStringVars(engine));

        this.updateVarTable();
    }

    private filteredVarIndices(engine: TrainerEngine): number[] {
        const view = engine.varView();
        const result: number[] = [];
        const filter = this.varFilter;
        const numeric = /^\d+$/.test(filter) ? Number(filter) : null;
        for (let i = 0; i < engine.varCount(); i++) {
            const value = view.length > i ? view[i] : engine.getVar(i);
            if (this.varNonZeroOnly && value === 0)
                continue;
            if (filter !== '') {
                if (numeric !== null && i === numeric) {
                    // exact index match
                } else if (engine.varName(i).toLowerCase().includes(filter.toLowerCase())) {
                    // name match
                } else if (String(value).includes(filter)) {
                    // value match
                } else {
                    continue;
                }
            }
            result.push(i);
            if (result.length > 20000)
                break;
        }
        return result;
    }

    private updateVarTable() {
        const engine = this.engine!;
        if (!this.varTableBody)
            return;
        const indices = this.filteredVarIndices(engine);
        const view = engine.varView();
        const pages = Math.max(1, Math.ceil(indices.length / this.varRowsPerPage));
        if (this.varPage >= pages)
            this.varPage = pages - 1;
        const slice = indices.slice(this.varPage * this.varRowsPerPage, (this.varPage + 1) * this.varRowsPerPage);

        const tbody = h('tbody');
        for (const index of slice)
            tbody.append(this.buildVarRow(engine, index, view.length > index ? view[index] : engine.getVar(index)));
        this.varTableBody.replaceWith(tbody);
        this.varTableBody = tbody;

        if (this.varSummary)
            this.varSummary.textContent =
                `匹配 ${indices.length} 项 · 第 ${this.varPage + 1}/${pages} 页 · 共 ${engine.varCount()} 个系统变量`;
    }

    private buildVarRow(engine: TrainerEngine, index: number, value: number): HTMLElement {
        const input = h('input', {type: 'number', class: 'form-input trainer-page-input', min: 0, max: 65535}) as HTMLInputElement;
        input.value = String(value);
        input.addEventListener('change', () => {
            const key = `var:${index}`;
            if (!this.originalValues.has(key))
                this.originalValues.set(key, engine.getVar(index));
            input.value = String(engine.setVar(index, Number(input.value) || 0));
        });
        const lockBox = h('input', {type: 'checkbox'}) as HTMLInputElement;
        const key = `var:${index}`;
        lockBox.checked = this.locks.has(key);
        lockBox.addEventListener('change', () => {
            if (lockBox.checked)
                this.locks.set(key, {kind: 'var', index, value: Number(input.value) || 0});
            else
                this.locks.delete(key);
            this.ensureLockTimer();
        });
        return h('tr', {},
            h('td', {class: 'trainer-mono', text: String(index)}),
            h('td', {class: 'trainer-name', text: engine.varName(index)}),
            h('td', {}, input),
            h('td', {}, lockBox));
    }

    private buildStringVars(engine: TrainerEngine): HTMLElement {
        const container = h('div', {class: 'trainer-strings'});
        const count = Math.min(engine.strVarCount(), 16);
        for (let i = 0; i < count; i++) {
            const index = i;
            const input = h('input', {type: 'text', class: 'form-input'}) as HTMLInputElement;
            input.value = engine.getStrVar(index);
            input.addEventListener('change', () => {
                const key = `str:${index}`;
                if (!this.originalValues.has(key))
                    this.originalValues.set(key, engine.getStrVar(index));
                engine.setStrVar(index, input.value);
            });
            container.append(h('label', {class: 'trainer-page-item'},
                h('span', {class: 'trainer-mono', text: `S${index}`}), input));
        }
        if (engine.strVarCount() > count)
            container.append(h('p', {class: 'trainer-hint', text: `仅显示前 ${count} 个（共 ${engine.strVarCount()} 个）`}));
        return container;
    }

    // -- 数值搜索 -----------------------------------------------------------

    private renderSearch() {
        const panel = this.panels.get('search')!;
        panel.textContent = '';

        panel.append(h('p', {class: 'trainer-hint'},
            '用法一（知道数值）：在游戏里记下当前数值（例如金钱），输入后点「首次扫描」；' +
            '回到游戏让数值变化，再回来选一个比较方式「再次扫描」，反复缩小范围直到只剩一两个结果。'));
        panel.append(h('p', {class: 'trainer-hint'},
            '用法二（数值看不到）：数值框留空直接点「首次扫描」，这会记下所有非零变量；' +
            '之后每让游戏跑一段就回来选「发生了变化 / 增加了 / 减少了」再扫描，可以把范围缩到很小。'));

        this.searchValueInput = h('input', {type: 'number', class: 'form-input', placeholder: '数值', min: 0, max: 65535}) as HTMLInputElement;
        const first = h('button', {class: 'btn btn-primary', type: 'button'}, '首次扫描');
        first.addEventListener('click', () => this.firstScan());

        this.searchOpSelect = h('select', {class: 'form-select'}) as HTMLSelectElement;
        for (const [value, label] of [
            ['eq', '等于'], ['ne', '不等于'], ['gt', '大于'], ['lt', '小于'],
            ['inc', '增加了'], ['dec', '减少了'], ['changed', '发生了变化'], ['same', '没有变化'],
        ])
            this.searchOpSelect.append(h('option', {value, text: label}));
        const next = h('button', {class: 'btn', type: 'button'}, '再次扫描');
        next.addEventListener('click', () => this.nextScan());
        const reset = h('button', {class: 'btn btn-link', type: 'button'}, '重置');
        reset.addEventListener('click', () => { this.candidates = []; this.searchKnown.clear(); this.updateSearchResults(); });

        panel.append(
            h('div', {class: 'trainer-toolbar'},
              this.searchValueInput, first,
              h('span', {class: 'trainer-sep'}, '／'),
              this.searchOpSelect, next, reset),
        );

        this.searchSummary = h('p', {class: 'trainer-summary'});
        panel.append(this.searchSummary);

        this.writeValueInput = h('input', {type: 'number', class: 'form-input', placeholder: '新数值', min: 0, max: 65535}) as HTMLInputElement;
        const writeSelected = h('button', {class: 'btn btn-primary', type: 'button'}, '把所有候选改成这个值');
        writeSelected.addEventListener('click', () => this.writeAllCandidates());
        const lockAll = h('button', {class: 'btn', type: 'button'}, '锁定所有候选');
        lockAll.addEventListener('click', () => {
            const value = Number(this.writeValueInput.value) || 0;
            for (const index of this.candidates)
                this.locks.set(`var:${index}`, {kind: 'var', index, value});
            this.ensureLockTimer();
            addToast(`已锁定 ${this.candidates.length} 个变量`, 'success');
        });
        panel.append(h('div', {class: 'trainer-toolbar'}, this.writeValueInput, writeSelected, lockAll));

        this.searchResultsEl = h('div', {class: 'trainer-search-results'});
        panel.append(this.searchResultsEl);
        this.updateSearchResults();
    }

    private firstScan() {
        const engine = this.engine!;
        const unknown = this.searchValueInput.value === '';
        const target = Number(this.searchValueInput.value);
        const view = engine.varView();
        this.candidates = [];
        this.searchKnown.clear();
        for (let i = 0; i < engine.varCount(); i++) {
            const value = view.length > i ? view[i] : engine.getVar(i);
            // An empty value box means "initial value unknown": snapshot every
            // non-zero variable and let the reader narrow it down by change.
            if (unknown ? value !== 0 : value === target) {
                this.candidates.push(i);
                this.searchKnown.set(i, value);
            }
        }
        addToast(unknown
            ? `首次扫描（未知初始值）：记下 ${this.candidates.length} 个非零变量`
            : `首次扫描：找到 ${this.candidates.length} 个候选变量`, 'success');
        this.updateSearchResults();
    }

    private nextScan() {
        const engine = this.engine!;
        const op = this.searchOpSelect.value;
        const targetText = this.searchValueInput.value;
        const target = Number(targetText);
        const view = engine.varView();
        const survivors: number[] = [];
        const updated = new Map<number, number>();
        for (const index of this.candidates) {
            const now = view.length > index ? view[index] : engine.getVar(index);
            const before = this.searchKnown.get(index) ?? now;
            let keep = false;
            switch (op) {
                case 'eq': keep = targetText === '' || now === target; break;
                case 'ne': keep = targetText === '' || now !== target; break;
                case 'gt': keep = now > target; break;
                case 'lt': keep = now < target; break;
                case 'inc': keep = now > before; break;
                case 'dec': keep = now < before; break;
                case 'changed': keep = now !== before; break;
                case 'same': keep = now === before; break;
            }
            if (keep) {
                survivors.push(index);
                updated.set(index, now);
            }
        }
        this.candidates = survivors;
        this.searchKnown = updated;
        this.updateSearchResults();
    }

    private updateSearchResults() {
        if (!this.searchResultsEl)
            return;
        const engine = this.engine!;
        this.searchResultsEl.textContent = '';
        if (this.searchSummary)
            this.searchSummary.textContent = `当前候选：${this.candidates.length} 个`;
        const view = engine.varView();
        const limit = 200;
        for (const index of this.candidates.slice(0, limit)) {
            const value = view.length > index ? view[index] : engine.getVar(index);
            const input = h('input', {type: 'number', class: 'form-input trainer-page-input', min: 0, max: 65535}) as HTMLInputElement;
            input.value = String(value);
            input.addEventListener('change', () => {
                const key = `var:${index}`;
                if (!this.originalValues.has(key))
                    this.originalValues.set(key, engine.getVar(index));
                engine.setVar(index, Number(input.value) || 0);
                this.searchKnown.set(index, Number(input.value) || 0);
            });
            this.searchResultsEl.append(h('div', {class: 'trainer-search-row'},
                h('span', {class: 'trainer-mono', text: `${index} ${engine.varName(index)}`}), input));
        }
        if (this.candidates.length > limit)
            this.searchResultsEl.append(h('p', {class: 'trainer-hint', text: `仅列出前 ${limit} 个候选`}));
        if (this.candidates.length === 0 && this.searchKnown.size === 0)
            this.searchResultsEl.append(h('p', {class: 'trainer-hint', text: '还没有开始扫描。'}));
    }

    private writeAllCandidates() {
        const engine = this.engine!;
        const value = Number(this.writeValueInput.value) || 0;
        for (const index of this.candidates) {
            const key = `var:${index}`;
            if (!this.originalValues.has(key))
                this.originalValues.set(key, engine.getVar(index));
            engine.setVar(index, value);
        }
        addToast(`已把 ${this.candidates.length} 个变量改为 ${value}`, 'success');
        this.updateSearchResults();
    }

    // -- 存档备份 -----------------------------------------------------------

    private renderSave() {
        const panel = this.panels.get('save')!;
        panel.textContent = '';
        this.saveDataManager = new SaveDataManager();

        panel.append(h('p', {class: 'trainer-hint'},
            '修改前建议先备份。存档保存在浏览器本地数据库中，可以导出为 ZIP 文件，之后再从这里恢复。'));

        const download = h('button', {class: 'btn btn-primary', type: 'button'}, '导出存档 ZIP');
        download.addEventListener('click', () => this.saveDataManager!.download());
        const restore = h('button', {class: 'btn', type: 'button'}, '从 ZIP 恢复');
        restore.addEventListener('click', () => {
            openFileInput().then((file) => this.saveDataManager!.extract(file));
        });
        panel.append(h('div', {class: 'trainer-actions'}, download, restore));

        const has = h('p', {class: 'trainer-hint'});
        panel.append(has);
        this.saveDataManager.hasSaveData().then((yes) => {
            has.textContent = yes ? '检测到本机已有存档。' : '本机暂时没有检测到存档。';
        });
    }

    // -- 锁定 ---------------------------------------------------------------

    private ensureLockTimer() {
        if (this.locks.size === 0) {
            if (this.lockTimer !== undefined) {
                window.clearInterval(this.lockTimer);
                this.lockTimer = undefined;
            }
            return;
        }
        if (this.lockTimer === undefined)
            this.lockTimer = window.setInterval(() => this.applyLocks(), 400);
    }

    private applyLocks() {
        const engine = this.engine;
        if (!engine)
            return;
        for (const lock of this.locks.values()) {
            if (lock.kind === 'var')
                engine.setVar(lock.index, Number(lock.value));
            else if (lock.kind === 'page' && lock.page !== undefined)
                engine.setPageVar(lock.page, lock.index, Number(lock.value));
            else if (lock.kind === 'long')
                engine.setLongVar(lock.index, Number(lock.value));
            else if (lock.kind === 'str')
                engine.setStrVar(lock.index, String(lock.value));
        }
    }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let panel: TrainerPanel | null = null;

export function openTrainer() {
    const game = activeGame();
    if (!game)
        return;
    if (!panel)
        panel = new TrainerPanel(game);
    panel.open();
}

// A toolbar button is injected only for the three supported games, so every
// other launch keeps its existing toolbar exactly as it was.
function installToolbarButton() {
    const game = activeGame();
    if (!game)
        return;
    if ($('#trainer-button'))
        return;
    const button = h('button', {
        id: 'trainer-button',
        class: 'btn btn-link tooltip tooltip-bottom mr-2 hidden-until-game-start',
        'data-tooltip': '修改器',
        type: 'button',
    });
    button.append(h('i', {class: 'fa fa-wrench'}));
    button.addEventListener('click', () => openTrainer());
    button.addEventListener('click', () => button.blur());
    const anchor = $('#settings-button');
    anchor.parentElement!.insertBefore(button, anchor);
}

export function initTrainer() {
    if (!activeGame())
        return;
    installToolbarButton();
    (window as any).ranceTrainer = {open: openTrainer};
}
