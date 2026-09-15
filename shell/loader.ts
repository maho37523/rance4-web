// Copyright (c) 2017 Kichikuou <KichikuouChrome@gmail.com>
// This source code is governed by the MIT License, see the LICENSE file.
import {$} from './util.js';
import {config} from './config.js';
import {LoaderSource, CDImageSource, FileSource, RemoteCDDAFileSource, ZipSource, SevenZipSource, NoGamedataError} from './loadersource.js';
import {setCDDALoader} from './cdda.js';
import {addToast} from './widgets.js';
import * as midiPlayer from './midi.js';
import * as volumeControl from './volume.js';
import {message} from './strings.js';
import { isDeflateSupported } from './zip.js';
import { diag, setFontStatus } from './diagnostics.js';

let cdSource: CDImageSource | undefined;
let installing = false;

export const REMOTE_LOAD_EVENT = 'load-remote-files';
export interface RemoteLoadDetail {
    files: File[];
    imageUrl: string;
    cueUrl: string;
    /** Music shipped as loose audio files rather than a disc image. */
    bgm?: {playlistName?: string, playlistText?: string, urls: Map<string, string>};
    /** Explicitly selected by a trusted game manifest; never inferred from
     * arbitrary user input. */
    encoding?: 'sjis' | 'gbk' | 'utf8';
}

let gameEncoding: RemoteLoadDetail['encoding'];
const GBK_FONT_FILE = 'SourceHanSansCN-Normal.otf';

// Chinese text needs a font that has the glyphs.
//
// The engine's bundled MTLc3m.ttf is a Japanese face: measured against Rance 4's
// own scenario it covers only 708 of the 929 distinct Chinese characters the
// script uses (76%), so a quarter of every line had no glyph at all.  The
// Chinese release ships SourceHanSansCN-Normal.otf beside its data and that font
// covers 929/929.  See tools/diag/font_coverage.py for the measurement.
//
// Loading it used to happen only for `-encoding gbk` (Kichikuou).  Rance 4 runs
// with `-encoding utf8`, so it rendered Chinese with the Japanese font -- which
// is what "文字几乎不可见" was.  Load it for every encoding that needs CJK glyphs.
const CJK_ENCODINGS = new Set(['gbk', 'utf8']);
// The font is published beside Rance 4's data, which is where the manifest
// serves it from regardless of which game is asking for it.
const CJK_FONT_OWNER = 'rance4';

async function prepareCjkFont(): Promise<boolean> {
    const started = performance.now();
    try {
        const url = new URL(`games/${CJK_FONT_OWNER}/${GBK_FONT_FILE}`, document.baseURI);
        // Prefer the launcher's cached fetch: the font is the largest single
        // asset outside the manifest, and re-downloading it every visit defeats
        // the download-once cache.
        const cachedFetch = (window as any).dshFetchCachedFile as
            ((url: string) => Promise<Blob>) | undefined;
        let bytes: Uint8Array;
        if (cachedFetch) {
            bytes = new Uint8Array(await (await cachedFetch(url.href)).arrayBuffer());
        } else {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            bytes = new Uint8Array(await response.arrayBuffer());
        }
        Module!.FS.writeFile(`/fonts/${GBK_FONT_FILE}`, bytes);
        setFontStatus('ok', {file: GBK_FONT_FILE, ms: Math.round(performance.now() - started), bytes: bytes.byteLength});
        return true;
    } catch (error) {
        // The engine can still start with its bundled font; keep the game
        // reachable rather than leaving its run dependency unresolved.
        console.warn('Unable to load the CJK fallback font:', error);
        setFontStatus('failed', {error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started)});
        addToast('中文字体加载失败，部分文字可能无法显示。', 'warning');
        return false;
    }
}

function init() {
    $('#fileselect').addEventListener('change', handleFileSelect, false);
    document.addEventListener(REMOTE_LOAD_EVENT, handleRemoteLoad as EventListener, false);
    document.body.ondragover = handleDragOver;
    document.body.ondrop = handleDrop;
}

function handleRemoteLoad(evt: Event) {
    const detail = (evt as CustomEvent<RemoteLoadDetail>).detail;
    // imageUrl/cueUrl may be empty for titles that ship loose audio files
    // instead of a disc image; the BGM source covers their music.
    if (installing || !detail || !Array.isArray(detail.files) ||
        typeof detail.imageUrl !== 'string' || typeof detail.cueUrl !== 'string')
        return;
    gameEncoding = detail.encoding;
    install(new RemoteCDDAFileSource(detail.files, detail.imageUrl, detail.cueUrl, detail.bgm));
}

function handleFileSelect(evt: Event) {
    let input = <HTMLInputElement>evt.target;
    handleFiles(input.files!);
    input.value = '';
}

function handleDragOver(evt: DragEvent) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer!.dropEffect = 'copy';
}

function handleDrop(evt: DragEvent) {
    evt.stopPropagation();
    evt.preventDefault();
    const items = evt.dataTransfer?.items;
    if (!items) return;
    if (items.length === 1) {
        const entry = items[0].webkitGetAsEntry();
        if (entry?.isDirectory) {
            handleDirectory(entry as FileSystemDirectoryEntry)
            return;
        }
    }
    handleFiles(evt.dataTransfer.files);
}

async function handleDirectory(entry: FileSystemDirectoryEntry) {
    const files: File[] = [];
    async function walk(entry: FileSystemDirectoryEntry, depth: number) {
        const entries = await new Promise<FileSystemEntry[]>(
            (res, rej) => entry.createReader().readEntries(res, rej));
        for (const e of entries) {
            if (e.isDirectory && depth > 0) {
                await walk(e as FileSystemDirectoryEntry, depth - 1);
            } else if (e.isFile) {
                const file = await new Promise<File>(
                    (res, rej) => (e as FileSystemFileEntry).file(res, rej));
                files.push(file);
            }
        }
    }
    await walk(entry, 1);
    handleFiles(files);
}

function handleFiles(files: FileList | File[]) {
    if (installing || files.length === 0)
        return;

    // A remote launcher may select a legacy encoding explicitly.  Local
    // imports must retain the engine default instead of inheriting that
    // selection if a page instance is reused.
    gameEncoding = undefined;

    let hasALD = false;
    let patchFiles: File[] = [];
    let unrecognized: File | undefined;
    for (let file of files) {
        if (isImageFile(file)) {
            if (!cdSource) {
                cdSource = new CDImageSource();
            }
            cdSource.addImageFile(file);
            $('#imgReady').classList.remove('notready');
            $('#imgReady').textContent = file.name;
        } else if (isMetadataFile(file)) {
            if (!cdSource) {
                cdSource = new CDImageSource();
            }
            cdSource.addMetadataFile(file);
            $('#cueReady').classList.remove('notready');
            $('#cueReady').textContent = file.name;
        } else if (file.name.match(/\.(ald|ain)$/i) || file.name.toLowerCase() === 'adisk.dat') {
            hasALD = true;
            patchFiles.push(file);
        } else {
            unrecognized = file;
        }
    }
    if (cdSource) {
        cdSource.addPatchFiles(patchFiles);
    }

    let source: LoaderSource | undefined;
    if (cdSource) {
        source = cdSource;
    } else {
        if (files.length == 1 && files[0].name.toLowerCase().endsWith('.zip') && isDeflateSupported) {
            source = new ZipSource(files[0]);
        } else if (files.length == 1 && files[0].name.match(/\.(zip|rar|7z)$/i)) {
            source = new SevenZipSource(files[0]);
        } else if (files.length > 2 && hasALD) {
            source = new FileSource(files);
        }
    }

    if (source && source.isReadyToLoad()) {
        install(source);
    } else if (unrecognized) {
        addToast(`${unrecognized.name}: ${message.unrecognized_format}`, 'warning');
    }
}

async function install(source: LoaderSource) {
    installing = true;
    try {
        await source.startLoad();
        setCDDALoader(source.getCDDALoader());
        loaded(source.hasMidi);
    } catch (err) {
        if (err instanceof NoGamedataError) {
            gtag('event', 'NoGamedata', { event_category: 'Loader', event_label: err.message, file_types: err.fileTypes });
            addToast(`${message.cannot_install}: ${err.message}`, 'warning');
        } else if (err instanceof Error) {
            gtag('event', 'LoadFailed', { event_category: 'Loader', event_label: err.message });
            addToast(`${message.cannot_install}: ${message.unrecognized_format}`, 'warning');
        }
    } finally {
        cdSource = undefined;
        installing = false;
    }
}

function isImageFile(file: File): boolean {
    let name = file.name.toLowerCase();
    return name.endsWith('.img') || name.endsWith('.bin') || name.endsWith('.mdf') || name.endsWith('.iso');
}

function isMetadataFile(file: File): boolean {
    let name = file.name.toLowerCase();
    return name.endsWith('.cue') || name.endsWith('.ccd') || name.endsWith('.mds');
}

function loaded(hasMidi: boolean) {
    if (hasMidi)
        midiPlayer.init(volumeControl.audioNode());
    $('#xsystem35').hidden = false;
    document.body.classList.add('game');
    $('#toolbar').classList.remove('before-game-start');
    window.onbeforeunload = onBeforeUnload;
    setTimeout(async () => {
        // `?cjkfont=0` renders with the engine's bundled font so the two can be
        // compared side by side on one machine.  The default is the correct one.
        const override = (window as any).__ranceCjkFontOverride as boolean | undefined;
        const wantCjkFont = override !== undefined ? override : CJK_ENCODINGS.has(gameEncoding ?? '');
        Module!.arguments.push(config.antialias ? '-antialias' : '-noantialias');
        Module!.arguments.push('-fm');
        if (gameEncoding) {
            Module!.arguments.push('-encoding', gameEncoding);
            if (wantCjkFont && await prepareCjkFont()) {
                Module!.arguments.push('-ttfont_gothic', `/fonts/${GBK_FONT_FILE}`);
                Module!.arguments.push('-ttfont_mincho', `/fonts/${GBK_FONT_FILE}`);
            } else if (!wantCjkFont) {
                setFontStatus('skipped', {reason: override === false ? '按 ?cjkfont=0 请求' : '该编码不需要中文字体'});
            }
        } else if (override !== false) {
            setFontStatus('skipped', {reason: '发布清单未指定编码'});
        }
        diag.setContext('encoding', gameEncoding ?? '(未指定)');
        diag.setContext('antialias', config.antialias);
        diag.setContext('arguments', [...Module!.arguments]);
        diag.setContext('cjkFontRequested', wantCjkFont);
        diag.record('life', '引擎参数已确定', {arguments: [...Module!.arguments].join(' ')});
        Module!.removeRunDependency('gameFiles');
        document.dispatchEvent(new Event('gamestart'));
    }, 0);
}

function onBeforeUnload(e: BeforeUnloadEvent) {
    if (config.unloadConfirmation) {
        e.returnValue = message.unload_confirmation;
        volumeControl.suspendForModalDialog();
    }
}

init();
