// Touch controls intentionally translate deliberate controller actions only.
// The game canvas never receives direct taps on coarse-pointer devices.
import {$, urlParams} from './util.js';

type GameKey = {
    key: string;
    code: string;
    keyCode: number;
};

const keys = {
    up: {key: 'ArrowUp', code: 'ArrowUp', keyCode: 38},
    down: {key: 'ArrowDown', code: 'ArrowDown', keyCode: 40},
    left: {key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37},
    right: {key: 'ArrowRight', code: 'ArrowRight', keyCode: 39},
    confirm: {key: 'Enter', code: 'Enter', keyCode: 13},
    secondary: {key: ' ', code: 'Space', keyCode: 32},
} satisfies Record<string, GameKey>;

const activePointers = new Map<number, GameKey>();
type BPress = {button: HTMLButtonElement; timer: number; long: boolean};
const bPresses = new Map<number, BPress>();
const B_LONG_PRESS_MS = 360;
let cursorMode = false;
let cursorX = 0;
let cursorY = 0;
let trackingPointer: number | undefined;
let trackingX = 0;
let trackingY = 0;

function canvas(): HTMLCanvasElement {
    return $('#canvas') as HTMLCanvasElement;
}

function sendKey(type: 'keydown' | 'keyup', gameKey: GameKey) {
    // Emscripten's SDL keyboard backend listens on document in some builds
    // and on the canvas in others. Dispatch on document: the event then
    // follows the normal document/window path without relying on a mobile
    // browser to bubble a synthetic event out of a canvas.
    const event = new KeyboardEvent(type, {
        key: gameKey.key,
        code: gameKey.code,
        bubbles: true,
        cancelable: true,
        composed: true,
    });
    // Some SDL/Emscripten mappings still read these legacy fields. Defining
    // them also works around mobile WebKit's read-only constructor options.
    Object.defineProperty(event, 'keyCode', {value: gameKey.keyCode});
    Object.defineProperty(event, 'which', {value: gameKey.keyCode});
    document.dispatchEvent(event);
}

function releasePointer(pointerId: number) {
    const gameKey = activePointers.get(pointerId);
    if (!gameKey) return;
    activePointers.delete(pointerId);
    sendKey('keyup', gameKey);
}

function releaseAllKeys() {
    for (const press of bPresses.values()) window.clearTimeout(press.timer);
    bPresses.clear();
    for (const pointerId of activePointers.keys()) releasePointer(pointerId);
}

function sendTap(gameKey: GameKey) {
    sendKey('keydown', gameKey);
    sendKey('keyup', gameKey);
}

function startBPress(button: HTMLButtonElement, event: PointerEvent) {
    if (bPresses.has(event.pointerId)) return;
    button.setPointerCapture(event.pointerId);
    const press: BPress = {
        button,
        long: false,
        timer: window.setTimeout(() => {
            const current = bPresses.get(event.pointerId);
            if (!current) return;
            current.long = true;
            // Hold Space only after the long-press threshold. This avoids a
            // short B producing both cancel and skip in the same gesture.
            activePointers.set(event.pointerId, keys.secondary);
            sendKey('keydown', keys.secondary);
            button.classList.add('active');
        }, B_LONG_PRESS_MS),
    };
    bPresses.set(event.pointerId, press);
}

function releaseBPress(pointerId: number) {
    const press = bPresses.get(pointerId);
    if (!press) return;
    bPresses.delete(pointerId);
    window.clearTimeout(press.timer);
    if (press.long) {
        releasePointer(pointerId);
    } else {
        // Escape is the engine's cancel/right-click equivalent.
        sendTap({key: 'Escape', code: 'Escape', keyCode: 27});
    }
    press.button.classList.remove('active');
}

function clampCursor() {
    const rect = canvas().getBoundingClientRect();
    cursorX = Math.min(Math.max(cursorX, rect.left), rect.right);
    cursorY = Math.min(Math.max(cursorY, rect.top), rect.bottom);
}

function updateCursor() {
    clampCursor();
    const marker = $('#touch-cursor');
    marker.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
    marker.hidden = !cursorMode;
}

function moveCursor() {
    canvas().dispatchEvent(new MouseEvent('mousemove', {
        clientX: cursorX,
        clientY: cursorY,
        bubbles: true,
        cancelable: true,
    }));
    updateCursor();
}

function clickAtCursor() {
    const options = {clientX: cursorX, clientY: cursorY, bubbles: true, cancelable: true};
    canvas().dispatchEvent(new MouseEvent('mousedown', options));
    window.setTimeout(() => canvas().dispatchEvent(new MouseEvent('mouseup', options)), 24);
}

function setCursorMode(nextMode: boolean) {
    cursorMode = nextMode;
    releaseAllKeys();
    const button = $('#touch-cursor-mode') as HTMLButtonElement;
    button.setAttribute('aria-pressed', String(cursorMode));
    button.classList.toggle('active', cursorMode);
    if (cursorMode) {
        const rect = canvas().getBoundingClientRect();
        cursorX = rect.left + rect.width / 2;
        cursorY = rect.top + rect.height / 2;
    }
    updateCursor();
}

function createButton(label: string, control?: keyof typeof keys, id?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-control-button';
    button.textContent = label;
    if (id) button.id = id;
    if (!control) return button;
    button.dataset.control = control;
    button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (cursorMode && control === 'confirm') {
            clickAtCursor();
            return;
        }
        if (control === 'secondary') {
            startBPress(button, event);
            return;
        }
        const gameKey = keys[control];
        if (activePointers.has(event.pointerId)) return;
        activePointers.set(event.pointerId, gameKey);
        button.setPointerCapture(event.pointerId);
        sendKey('keydown', gameKey);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(eventName, (event: Event) => {
            event.preventDefault();
            if (control === 'secondary') {
                releaseBPress((event as PointerEvent).pointerId);
                return;
            }
            releasePointer((event as PointerEvent).pointerId);
        });
    }
    return button;
}

function createControls() {
    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.hidden = true;
    root.innerHTML = '<div id="touch-input-shield" aria-hidden="true"></div><div id="touch-cursor" hidden aria-hidden="true"></div>';

    const dpad = document.createElement('div');
    dpad.className = 'touch-dpad';
    dpad.append(createButton('▲', 'up'));
    dpad.append(createButton('◀', 'left'));
    dpad.append(createButton('▼', 'down'));
    dpad.append(createButton('▶', 'right'));

    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    actions.append(createButton('B', 'secondary'));
    actions.append(createButton('A', 'confirm'));
    const cursorButton = createButton('光标', undefined, 'touch-cursor-mode');
    cursorButton.setAttribute('aria-label', '切换光标模式');
    cursorButton.setAttribute('aria-pressed', 'false');
    cursorButton.addEventListener('click', (event) => {
        event.preventDefault();
        setCursorMode(!cursorMode);
    });
    const menuButton = createButton('菜单');
    menuButton.setAttribute('aria-label', '打开设置');
    menuButton.addEventListener('click', (event) => {
        event.preventDefault();
        releaseAllKeys();
        ($('#settings-button') as HTMLButtonElement).click();
    });
    actions.append(cursorButton, menuButton);

    root.append(dpad, actions);
    document.body.append(root);

    const shield = $('#touch-input-shield');
    shield.addEventListener('pointerdown', (event: PointerEvent) => {
        event.preventDefault();
        if (!cursorMode) return;
        trackingPointer = event.pointerId;
        trackingX = event.clientX;
        trackingY = event.clientY;
        shield.setPointerCapture(event.pointerId);
    });
    shield.addEventListener('pointermove', (event: PointerEvent) => {
        event.preventDefault();
        if (!cursorMode || trackingPointer !== event.pointerId) return;
        cursorX += (event.clientX - trackingX) * 0.9;
        cursorY += (event.clientY - trackingY) * 0.9;
        trackingX = event.clientX;
        trackingY = event.clientY;
        moveCursor();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        shield.addEventListener(eventName, (event: Event) => {
            event.preventDefault();
            if (trackingPointer === (event as PointerEvent).pointerId) trackingPointer = undefined;
        });
    }
}

document.addEventListener('gamestart', () => {
    const enabled = matchMedia('(pointer: coarse)').matches || urlParams.get('touch') === '1';
    document.body.classList.toggle('touch-controls-enabled', enabled);
    createControls();
    const root = $('#touch-controls');
    root.hidden = false;
    window.addEventListener('blur', releaseAllKeys);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseAllKeys();
    });
    window.addEventListener('resize', updateCursor);
});
