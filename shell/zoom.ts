// Copyright (c) 2017 Kichikuou <KichikuouChrome@gmail.com>
// This source code is governed by the MIT License, see the LICENSE file.
import {$} from './util.js';
import {config} from './config.js';

const canvas = <HTMLCanvasElement>$('#canvas');
const zoomSelect = <HTMLInputElement>$('#zoom');
const pixelateCheckbox = <HTMLInputElement>$('#pixelate');
let throttling = false;

function init() {
    zoomSelect.addEventListener('change', handleZoom);
    zoomSelect.value = config.zoom;
    if (CSS.supports('image-rendering', 'pixelated') || CSS.supports('image-rendering', '-moz-crisp-edges')) {
        pixelateCheckbox.addEventListener('change', handlePixelate);
        if (config.pixelate) {
            pixelateCheckbox.checked = true;
            handlePixelate();
        }
    } else {
        pixelateCheckbox.setAttribute('disabled', 'true');
    }
    if (screen.orientation) {
        screen.orientation.addEventListener('change', () => {
            if (screen.orientation.type.startsWith('landscape'))
                requestFullscreen();
            else
                exitFullscreen();
        });
    }
    window.addEventListener('resize', onResize);
    watchStage();
}

export function handleZoom() {
    let value = zoomSelect.value;
    config.zoom = value;
    config.persist();
    let navbarStyle = $('.navbar').style;
    if (value === 'fit') {
        $('#xsystem35').classList.add('fit');
        navbarStyle.maxWidth = 'none';
        if (!applyCanvasSize())
            canvas.style.width = '';
    } else {
        $('#xsystem35').classList.remove('fit');
        canvas.style.width = canvas.style.height = '';
        let ratio = Number(value);
        navbarStyle.maxWidth = canvas.style.width = canvas.width * ratio + 'px';
    }
}

/** Whole multiples below this are only used when they are an exact fit. */
const MIN_SNAPPED_SCALE = 2;
/** Above this the integer multiple leaves a visible band of dead space. */
const MAX_INTEGER_WASTE = 0.82;

/**
 * Size the canvas in whole multiples of its own resolution when that fits well.
 *
 * Non-integer scaling is what makes the text drift: a 4:3 picture contained in
 * an arbitrary box lands on fractional pixels, so glyph edges move depending on
 * which pixel row they fall on.  Snapping to 1x/2x/3x removes that entirely,
 * because every game pixel becomes an exact square of screen pixels.  When the
 * stage is too small or too awkward for a whole multiple, fall back to a
 * fractional fit rather than leaving most of the screen unused.
 *
 * Returns true when it applied a whole multiple.
 */
export function applyCanvasSize(): boolean {
    const stage = $('#xsystem35');
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    // Nothing meaningful to compute until both the canvas and the stage have
    // been laid out; the caller falls back to the CSS default.
    if (!canvasWidth || !canvasHeight || !stageWidth || !stageHeight)
        return false;

    const exact = Math.min(stageWidth / canvasWidth, stageHeight / canvasHeight);
    const whole = Math.floor(exact);
    const useful = whole >= MIN_SNAPPED_SCALE
        ? whole / exact >= MAX_INTEGER_WASTE
        // 1x is only worth snapping for when it is what the box asks for;
        // otherwise a fractional fit keeps the desktop 100% setting honest.
        : whole === 1 && exact >= 0.95 && exact <= 1.05;
    const scale = useful ? whole : exact;

    // Round the binding dimension and derive the other from the canvas aspect,
    // so the picture keeps its exact ratio at fractional scales.  Rounding both
    // independently would distort it by up to a pixel in each direction.
    const scaleX = stageWidth / canvasWidth;
    const scaleY = stageHeight / canvasHeight;
    let width: number;
    let height: number;
    if (scaleX < scaleY) {
        width = Math.max(1, Math.round(canvasWidth * scale));
        height = Math.max(1, Math.round(width * canvasHeight / canvasWidth));
    } else {
        height = Math.max(1, Math.round(canvasHeight * scale));
        width = Math.max(1, Math.round(height * canvasWidth / canvasHeight));
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return useful;
}

function onResize() {
    if (throttling)
        return;
    throttling = true;
    window.requestAnimationFrame(() => {
        recalcAspectRatio();
        throttling = false;
    });
}

export function recalcAspectRatio() {
    let container = $('.contents');
    let target = $('#xsystem35');
    let containerAspect = container.offsetWidth / container.offsetHeight;
    if (!containerAspect)
        return;
    let canvasAspect = canvas.width / canvas.height;
    if (containerAspect < canvasAspect) {
        target.classList.add('letterbox');
        target.classList.remove('pillarbox');
    } else {
        target.classList.remove('letterbox');
        target.classList.add('pillarbox');
    }
    // The stage box changes with the aspect-ratio class, so snap the canvas
    // after the class is applied, not before.
    if (config.zoom === 'fit' && applyCanvasSize())
        return;
    if (config.zoom === 'fit')
        canvas.style.width = canvas.style.height = '';
}

/** Re-snap when the layout system changes the stage behind our back. */
function watchStage() {
    const stage = $('#xsystem35');
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
            if (config.zoom === 'fit' && !throttling)
                onResize();
        });
        observer.observe(stage);
    }
    // Touch mode is switched on at gamestart, which changes the stage rules.
    document.addEventListener('gamestart', () => {
        window.requestAnimationFrame(() => {
            recalcAspectRatio();
        });
    });
}

function handlePixelate() {
    config.pixelate = pixelateCheckbox.checked;
    config.persist();
    if (pixelateCheckbox.checked)
        canvas.classList.add('pixelated');
    else
        canvas.classList.remove('pixelated');
}

function requestFullscreen() {
    let e = document.documentElement;
    if (e.requestFullscreen)
        e.requestFullscreen();
    else if ((e as any).webkitRequestFullScreen)
        (e as any).webkitRequestFullScreen();
}

function exitFullscreen() {
    if (document.exitFullscreen) {
        if ((document as any).fullscreenElement)
            document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
        if ((document as any).webkitFullscreenElement)
            (document as any).webkitExitFullscreen();
    }
}

init();
