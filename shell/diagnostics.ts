// Flight recorder for real-device incidents.
//
// The Kichikuou lockup happens during play on a phone, and the machine that
// reproduces it is not the machine that debugs it.  Browser devtools are not
// available there, so the shell has to carry its own black box: a bounded
// ring buffer of everything that could distinguish "the engine hung" from
// "a CD track is still downloading", plus a one-tap export.
//
// Two properties matter more than completeness:
//
//   1. It must never break the game.  Every public entry point is wrapped, and
//      every hook is additive -- nothing here changes control flow.
//   2. It must survive a main-thread hang.  A timer on the main thread stops
//      firing exactly when the interesting thing happens, so the watchdog runs
//      in a Worker and reports the silence from outside.
import {$, urlParams} from './util.js';

const MAX_EVENTS = 1200;
const HEARTBEAT_MS = 500;
const WATCHDOG_SILENCE_MS = 3000;

type EventCategory =
    | 'life'      // startup, gamestart, arguments, environment
    | 'font'      // CJK font preparation
    | 'page'      // scenario page / address changes
    | 'net'       // requests issued by the launcher and data layer
    | 'audio'     // CD/BGM request and playback path
    | 'error'     // console errors, toasts, unhandled rejections
    | 'watchdog'  // main-thread responsiveness, measured from a Worker
    | 'ui'        // dialogs opened/closed
    | 'input'     // user input, kept coarse
    | 'vitals';   // memory, storage, visibility

interface RecorderEvent {
    /** Milliseconds since the recorder was installed. */
    t: number;
    cat: EventCategory;
    msg: string;
    detail?: Record<string, unknown>;
}

/** Every call is optional and must not throw; callers are on hot paths. */
export const diag = {
    record(cat: EventCategory, msg: string, detail?: Record<string, unknown>): void {
        push(cat, msg, detail);
    },
    /** Context that is re-printed on every export (game, encoding, flags...). */
    setContext(key: string, value: unknown): void {
        try {
            context[key] = value;
        } catch { /* recorder must never throw */ }
    },
    /** Current scenario position, sampled cheaply.  Returns null when unknown. */
    position(): {page: number; addr: number} | null {
        const m = window.Module as any;
        if (!m || typeof m._cheat_page !== 'function')
            return null;
        try {
            return {page: m._cheat_page(), addr: typeof m._cheat_addr === 'function' ? m._cheat_addr() : -1};
        } catch {
            return null;
        }
    },
    open(): void {
        try {
            panel?.showModal();
        } catch { /* no DOM yet */ }
    },
    /** Serialized report; also used by the local diagnostic harness. */
    report(): string {
        return buildReport();
    },
};

const events: RecorderEvent[] = [];
const context: Record<string, unknown> = {};
let installed = false;
let startedAt = 0;
let panel: HTMLDialogElement | null = null;
let lastPosition: string | null = null;
let lastNetworkFailure = '无';
let lastEngineOutput = '无';
let heartbeatTimer: number | undefined;
let vitalsTimer: number | undefined;

function push(cat: EventCategory, msg: string, detail?: Record<string, unknown>): void {
    try {
        if (!installed)
            return;
        if (events.length >= MAX_EVENTS)
            events.splice(0, 200);
        events.push({t: Math.round(performance.now() - startedAt), cat, msg, detail});
    } catch { /* recorder must never throw */ }
}

function fmtDetail(detail?: Record<string, unknown>): string {
    if (!detail)
        return '';
    const parts: string[] = [];
    for (const [key, value] of Object.entries(detail)) {
        if (value === undefined || value === null || value === '')
            continue;
        parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
    return parts.length ? ` ${parts.join(' ')}` : '';
}

function environment(): Record<string, unknown> {
    const m = window.Module as any;
    const nav = navigator as any;
    return {
        url: location.href,
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        screen: `${screen.width}x${screen.height}`,
        orientation: screen.orientation?.type ?? (matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'),
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        touchControls: document.body.classList.contains('touch-controls-enabled'),
        encoding: context['encoding'],
        antialias: context['antialias'],
        zoom: context['zoom'],
        engineArguments: m?.arguments ?? context['arguments'] ?? null,
        engineName: typeof m?._cheat_engine_id === 'function'
            ? (m._cheat_engine_id() === 2 ? 'system3' : 'xsystem35')
            : 'unknown',
        deviceMemory: nav.deviceMemory ?? null,
        hardwareConcurrency: navigator.hardwareConcurrency,
        audioContext: typeof AudioContext !== 'undefined' ? (window as any).__cddaAudioContextState ?? 'unknown' : 'unsupported',
    };
}

async function storageInfo(): Promise<string> {
    try {
        if (!navigator.storage?.estimate)
            return 'unavailable';
        const {usage, quota} = await navigator.storage.estimate();
        const mb = (v?: number) => (v === undefined ? '?' : (v / 1048576).toFixed(1));
        return `${mb(usage)} / ${mb(quota)} MB`;
    } catch {
        return 'unavailable';
    }
}

function buildReport(): string {
    const lines: string[] = [];
    lines.push('=== Rance Web 诊断报告 ===');
    lines.push(`导出时间: ${new Date().toISOString()}`);
    lines.push(`记录起点: 页面脚本执行后 ${startedAt.toFixed(0)} ms`);
    lines.push(`事件条数: ${events.length}${events.length >= MAX_EVENTS ? '（已滚动，只保留最近部分）' : ''}`);
    lines.push('');
    lines.push('--- 环境 ---');
    for (const [key, value] of Object.entries(environment()))
        lines.push(`${key}: ${value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    lines.push(`最近一次网络失败: ${lastNetworkFailure}`);
    lines.push(`最近一次音频/引擎输出: ${lastEngineOutput}`);
    lines.push(`storage: ${storageLabel}`);
    lines.push(`canvas: ${canvasLabel}`);
    lines.push(`font: ${fontLabel}`);
    lines.push('');
    lines.push('--- 事件时间线（t = 页面脚本执行后的毫秒数）---');
    for (const e of events)
        lines.push(`[${String(e.t).padStart(8)}] ${e.cat.padEnd(8)} ${e.msg}${fmtDetail(e.detail)}`);
    lines.push('');
    lines.push('--- 时间线结束 ---');
    return lines.join('\n');
}

let storageLabel = 'measuring...';
let canvasLabel = '(未测量)';
let fontLabel = '(未记录)';

function updateCanvasLabel(): void {
    try {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
        const stage = document.getElementById('xsystem35');
        if (!canvas)
            return;
        const rect = canvas.getBoundingClientRect();
        const stageRect = stage?.getBoundingClientRect();
        const scale = rect.width > 0 ? (rect.width / (canvas.width || 1)) : 0;
        canvasLabel = [
            `内部分辨率 ${canvas.width}x${canvas.height}`,
            `显示尺寸 ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`,
            `缩放 ${scale.toFixed(3)}x${Number.isInteger(Math.round(scale * 100) / 100) ? '' : ''}`,
            stageRect ? `舞台 ${stageRect.width.toFixed(0)}x${stageRect.height.toFixed(0)}` : '',
            `屏幕占比 ${(rect.width / window.innerWidth * 100).toFixed(0)}%x${(rect.height / window.innerHeight * 100).toFixed(0)}%`,
        ].filter(Boolean).join(' | ');
    } catch { /* ignore */ }
}

function installConsoleCapture(): void {
    const originals: Array<['log' | 'warn' | 'error', (...args: unknown[]) => void]> = [
        ['log', console.log.bind(console)],
        ['warn', console.warn.bind(console)],
        ['error', console.error.bind(console)],
    ];
    for (const [level, original] of originals) {
        console[level] = (...args: unknown[]) => {
            original(...args);
            const text = args.map((a) => (typeof a === 'string' ? a : safeString(a))).join(' ');
            push(level === 'log' ? 'life' : 'error', `console.${level}: ${truncate(text)}`);
            if (level !== 'log')
                lastEngineOutput = truncate(text);
        };
    }
    window.addEventListener('error', (evt) => {
        const target = evt.target as HTMLElement | null;
        if (target && target !== (window as any) && (target as any).src) {
            push('net', `资源加载失败: ${(target as any).src}`);
            lastNetworkFailure = `资源加载失败 ${(target as any).src}`;
        }
    }, true);
    window.addEventListener('unhandledrejection', (evt) => {
        const reason = (evt as PromiseRejectionEvent).reason;
        push('error', `unhandledrejection: ${truncate(safeString(reason))}`);
        lastEngineOutput = truncate(safeString(reason));
    });
}

function safeString(value: unknown): string {
    try {
        if (value instanceof Error)
            return `${value.name}: ${value.message}`;
        if (typeof value === 'string')
            return value;
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function truncate(text: string, max = 400): string {
    return text.length > max ? text.slice(0, max) + `…(共 ${text.length} 字)` : text;
}

/** Full URLs are long and mostly identical; the tail identifies the asset. */
function shortenUrl(url: string): string {
    try {
        const parsed = new URL(url, location.href);
        if (parsed.origin === location.origin) {
            const parts = parsed.pathname.split('/').filter(Boolean);
            return parts.slice(-2).join('/') + parsed.search;
        }
        return parsed.host + '/' + parsed.pathname.split('/').filter(Boolean).slice(-2).join('/');
    } catch {
        return url.length > 80 ? url.slice(0, 80) + '…' : url;
    }
}

function installAudioCapture(): void {
    const audio = document.getElementById('audio') as HTMLAudioElement | null;
    if (audio) {
        for (const name of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'ended', 'error'] as const) {
            audio.addEventListener(name, () => {
                const error = audio.error;
                push('audio', `<audio> ${name}`, {
                    src: audio.currentSrc ? audio.currentSrc.split('/').pop()?.slice(0, 40) : '',
                    readyState: audio.readyState,
                    networkState: audio.networkState,
                    error: error ? `${error.code}:${error.message}` : undefined,
                });
                if (name === 'error')
                    lastEngineOutput = `audio error ${error?.code}`;
            });
        }
    }
    // AudioContext state is the difference between "no sound" and "blocked by
    // autoplay policy", which looks identical from the outside.
    const originalResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function (this: AudioContext) {
        push('audio', 'AudioContext.resume() 被调用', {state: this.state});
        return originalResume.call(this).then((v) => {
            (window as any).__cddaAudioContextState = this.state;
            push('audio', `AudioContext.resume() 完成: ${this.state}`);
            return v;
        });
    };
}

function installWatchdog(): void {
    let worker: Worker;
    try {
        const source = `
            let last = Date.now();
            self.onmessage = (e) => {
                if (e.data === 'beat') { last = Date.now(); return; }
                const silent = Date.now() - last;
                if (silent > ${WATCHDOG_SILENCE_MS})
                    self.postMessage(Math.round(silent));
            };
            setInterval(() => self.postMessage('check'), 1000);
        `;
        worker = new Worker(URL.createObjectURL(new Blob([source], {type: 'text/javascript'})));
    } catch (e) {
        push('watchdog', `看门狗不可用: ${safeString(e)}`);
        return;
    }
    worker.onmessage = (evt) => {
        if (evt.data === 'check') {
            worker.postMessage('beat');
            return;
        }
        // The main thread went silent.  This is the single most valuable line
        // in the log: it separates an engine hang from a slow download.
        const silentMs = Number(evt.data);
        push('watchdog', `主线程无响应约 ${silentMs} ms`, {position: lastPosition ?? '未记录'});
        lastEngineOutput = `主线程卡住约 ${silentMs} ms`;
    };
    worker.onerror = () => push('watchdog', '看门狗线程报错');
    heartbeats.push(worker);
}

const heartbeats: Worker[] = [];

function samplePage(): void {
    const position = diag.position();
    if (!position) {
        push('page', '当前引擎不提供页码接口（system3 或尚未启动）');
        return;
    }
    const key = `${position.page}:${position.addr}`;
    if (key !== lastPosition) {
        // Kept verbose on purpose: the page before a hang is the hang's address.
        push('page', `page=${position.page} addr=0x${(position.addr >>> 0).toString(16)}`,
            lastPosition ? {from: lastPosition} : undefined);
        lastPosition = key;
    }
    updateCanvasLabel();
}

function installPageSampling(): void {
    document.addEventListener('gamestart', () => {
        window.setInterval(samplePage, HEARTBEAT_MS);
        samplePage();
    });
}

function installVitals(): void {
    const sample = async () => {
        const memory = (performance as any).memory;
        push('vitals', '周期采样', {
            visibility: document.hidden ? 'hidden' : 'visible',
            heapMB: memory ? (memory.usedJSHeapSize / 1048576).toFixed(1) : undefined,
            heapLimitMB: memory ? (memory.jsHeapSizeLimit / 1048576).toFixed(0) : undefined,
        });
        storageLabel = await storageInfo();
        updateCanvasLabel();
    };
    vitalsTimer = window.setInterval(sample, 15000);
    window.setTimeout(sample, 1000);
}

function installInputCapture(): void {
    // Deliberately coarse: enough to correlate a hang with what the player did,
    // without recording a stream of coordinates.
    let lastInput = 0;
    const note = (kind: string) => {
        const now = performance.now();
        if (now - lastInput < 800)
            return;
        lastInput = now;
        push('input', `${kind}`, {position: lastPosition ?? undefined});
    };
    document.addEventListener('pointerdown', () => note('pointerdown'), true);
    document.addEventListener('keydown', (evt) => {
        if ((evt.target as HTMLElement | null)?.tagName === 'INPUT')
            return;
        note(`keydown ${evt.key}`);
    }, true);
}

function installPanel(): void {
    panel = document.createElement('dialog');
    panel.id = 'diagnostics';
    panel.className = 'modal-container diagnostics';
    panel.innerHTML = `
        <div class="modal-header"><div class="modal-title">诊断报告</div></div>
        <div class="modal-body">
          <p class="diagnostics-hint">卡死或异常后打开这里，把内容复制发给开发者即可定位问题。内容只在本机生成，不会自动上传。</p>
          <div class="diagnostics-actions">
            <button type="button" class="btn btn-primary" data-copy>复制到剪贴板</button>
            <button type="button" class="btn" data-download>下载为文件</button>
            <span class="diagnostics-status"></span>
          </div>
          <textarea class="diagnostics-text" readonly spellcheck="false"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn diagnostics-close">关闭</button>
        </div>`;
    document.body.appendChild(panel);

    const textarea = panel.querySelector('.diagnostics-text') as HTMLTextAreaElement;
    const status = panel.querySelector('.diagnostics-status') as HTMLElement;
    panel.querySelector('.diagnostics-close')!.addEventListener('click', () => panel!.close());
    panel.addEventListener('click', (e) => { if (e.target === panel) panel!.close(); });

    panel.querySelector('[data-copy]')!.addEventListener('click', async () => {
        textarea.select();
        try {
            await navigator.clipboard.writeText(textarea.value);
            status.textContent = '已复制';
        } catch {
            // Clipboard permission is not guaranteed; the selection is already
            // made so the platform's own copy gesture still works.
            document.execCommand?.('copy');
            status.textContent = '已选中，请手动复制';
        }
    });
    panel.querySelector('[data-download]')!.addEventListener('click', () => {
        const blob = new Blob([textarea.value], {type: 'text/plain;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rance-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        status.textContent = '已下载';
    });

    // Rebuild on open so the report always reflects the moment it is needed.
    const originalShowModal = panel.showModal.bind(panel);
    panel.showModal = () => {
        textarea.value = buildReport();
        originalShowModal();
        textarea.scrollTop = textarea.scrollHeight;
    };
}

function installToolbarButton(): void {
    const anchor = document.getElementById('settings-button');
    if (!anchor || document.getElementById('diagnostics-button'))
        return;
    const button = document.createElement('button');
    button.id = 'diagnostics-button';
    button.type = 'button';
    button.className = 'btn btn-link tooltip tooltip-bottom mr-2';
    button.dataset.tooltip = '诊断日志';
    const icon = document.createElement('i');
    icon.className = 'fa fa-stethoscope';
    button.append(icon);
    button.addEventListener('click', () => { diag.open(); button.blur(); });
    anchor.parentElement!.insertBefore(button, anchor);
}

/**
 * A small floating handle that only shows up when the toolbar cannot: on
 * coarse-pointer devices the toolbar is hidden in landscape, which is exactly
 * where the lockup is observed.
 */
function installFloatingHandle(): void {
    const handle = document.createElement('button');
    handle.id = 'diagnostics-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', '诊断日志');
    handle.textContent = '诊';
    handle.addEventListener('click', () => diag.open());
    document.body.appendChild(handle);
    document.addEventListener('gamestart', () => { handle.hidden = false; });
}

/** `?diag=1`: an on-screen overlay that survives not having devtools. */
function installOverlay(): void {
    if (urlParams.get('diag') !== '1')
        return;
    const overlay = document.createElement('div');
    overlay.id = 'diagnostics-overlay';
    overlay.innerHTML = '<div class="diagnostics-overlay-line" data-page>page: -</div>' +
        '<div class="diagnostics-overlay-line" data-explain>等待游戏启动…</div>' +
        '<div class="diagnostics-overlay-line" data-net>网络: -</div>';
    document.body.appendChild(overlay);
    const pageEl = overlay.querySelector('[data-page]') as HTMLElement;
    const netEl = overlay.querySelector('[data-net]') as HTMLElement;
    const explainEl = overlay.querySelector('[data-explain]') as HTMLElement;

    window.setInterval(() => {
        const position = diag.position();
        const positionText = position ? `page ${position.page} addr 0x${(position.addr >>> 0).toString(16)}` : '未启动';
        pageEl.textContent = `page: ${positionText}`;
        const audio = document.getElementById('audio') as HTMLAudioElement | null;
        netEl.textContent = `网络: ${lastNetworkFailure}`;
        explainEl.textContent = audio
            ? `音频 readyState=${audio.readyState} networkState=${audio.networkState}${audio.error ? ` error=${audio.error.code}` : ''}`
            : '音频: -';
    }, 500);
}

function installDiagnosticHooks(): void {
    // The launcher's own fetch paths are instrumented where they happen, but a
    // window-level wrapper catches anything the launcher forgot (notably the
    // Worker-hosted CD proxy and the service worker's cache lookups).
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const range = init?.headers ? (init.headers as any).Range ?? (init.headers as any).range : undefined;
        const shortUrl = shortenUrl(url);
        const started = performance.now();
        return originalFetch(input, init).then((response) => {
            const ms = Math.round(performance.now() - started);
            const category: EventCategory = /cd\.(img|cue)|\.mp3|\.ogg|\.wav/i.test(shortUrl) ? 'audio' : 'net';
            push(category, `fetch ${response.status} ${shortUrl} ${ms}ms`, {
                range,
                contentRange: response.headers.get('Content-Range') ?? undefined,
                length: response.headers.get('Content-Length') ?? undefined,
            });
            if (!response.ok) {
                lastNetworkFailure = `${response.status} ${shortUrl}`;
                push('error', `请求失败 ${response.status} ${shortUrl}`, {range});
            }
            return response;
        }, (error) => {
            const ms = Math.round(performance.now() - started);
            lastNetworkFailure = `${safeString(error)} ${shortUrl}`;
            push('error', `fetch 抛错 ${shortUrl} ${ms}ms`, {error: safeString(error), range});
            throw error;
        });
    };
}

export function installDiagnostics(): void {
    if (installed)
        return;
    installed = true;
    startedAt = performance.now();
    try {
        // Read early, before the loader decides which font to use; the loader
        // cannot import this module's state without a cycle.
        const cjk = urlParams.get('cjkfont');
        if (cjk !== null)
            (window as any).__ranceCjkFontOverride = cjk !== '0';
        installConsoleCapture();
        installAudioCapture();
        installDiagnosticHooks();
        installPanel();
        installToolbarButton();
        installFloatingHandle();
        installOverlay();
        installPageSampling();
        installInputCapture();
        installVitals();
        installWatchdog();
        document.addEventListener('gamestart', () => {
            push('life', 'gamestart');
            setTimeout(updateCanvasLabel, 1000);
        });
        // Late-arriving DOM: the toolbar is present from the start, but the
        // canvas only exists once the loader runs.
        window.addEventListener('load', () => {
            updateCanvasLabel();
            push('life', 'window load', {readyState: document.readyState});
        });
        push('life', '诊断记录器已安装', {url: location.href});
        // Readable from the console on a desktop and from the local diagnostic
        // harness, which needs the report without a round trip through a dialog.
        (window as any).ranceDiag = {
            report: () => buildReport(),
            events: () => events.slice(),
            context: () => ({...context}),
            position: () => diag.position(),
        };
    } catch (e) {
        // A broken recorder must not be worse than no recorder; restore what we
        // can and continue without diagnostics.
        installed = false;
        try {
            console.warn('诊断记录器安装失败：', e);
        } catch { /* ignore */ }
    }
}

export function setFontStatus(status: 'ok' | 'failed' | 'skipped', detail?: Record<string, unknown>): void {
    fontLabel = status === 'ok'
        ? `已装载${detail?.file ? ` ${detail.file}` : ''}${detail?.ms ? ` 耗时 ${detail.ms}ms` : ''}`
        : status === 'failed'
            ? `装载失败：${detail?.error ?? '未知'}`
            : `未装载（游戏未使用中文字体参数）`;
    push('font', `中文字体 ${status}`, detail);
}

export function noteAudio(label: string, detail?: Record<string, unknown>): void {
    lastEngineOutput = label;
    push('audio', label, detail);
}

/** Kept for symmetry with guide/trainer so their open/close is on the timeline. */
export function noteUi(label: string): void {
    push('ui', label);
}
