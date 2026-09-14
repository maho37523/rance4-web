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

async function prepareGbkFont(): Promise<boolean> {
    try {
        const url = new URL(`games/rance4/${GBK_FONT_FILE}`, document.baseURI);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        Module!.FS.writeFile(`/fonts/${GBK_FONT_FILE}`, new Uint8Array(await response.arrayBuffer()));
        return true;
    } catch (error) {
        // The engine can still start with its bundled font; keep the game
        // reachable rather than leaving its run dependency unresolved.
        console.warn('Unable to load the GBK fallback font:', error);
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
        Module!.arguments.push(config.antialias ? '-antialias' : '-noantialias');
        Module!.arguments.push('-fm');
        if (gameEncoding) {
            Module!.arguments.push('-encoding', gameEncoding);
            if (gameEncoding === 'gbk' && await prepareGbkFont()) {
                Module!.arguments.push('-ttfont_gothic', `/fonts/${GBK_FONT_FILE}`);
                Module!.arguments.push('-ttfont_mincho', `/fonts/${GBK_FONT_FILE}`);
            }
        }
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
