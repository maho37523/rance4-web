// Shared state for the GBK font the shell installs for Chinese game data.
//
// Kept in its own module so loader.ts and loadersource.ts can both reach it
// without importing each other: the game data may ship the very same font file
// (Rance 4 declares it in .xsys35rc, and the engine applies that file after
// argv, so it overrides -ttfont_gothic), and transferring those bytes twice is
// 8 MB of the start payload.

export const GBK_FONT_FILE = 'SourceHanSansCN-Normal.otf';

let bytes: Uint8Array | null = null;

export function setGbkFontBytes(value: Uint8Array) {
    bytes = value;
}

export function getGbkFontBytes(): Uint8Array | null {
    return bytes;
}

export function gbkFontReady(): boolean {
    return bytes !== null;
}

export function gbkFontFileName(): string {
    return GBK_FONT_FILE;
}

/**
 * Fetch the GBK font and install it at /fonts/.
 *
 * Must run after the engine module exists, because it writes into Module.FS.
 * A failure is not fatal: the engine can fall back to a bundled font, so the
 * game stays reachable.
 */
export async function prepareGbkFont(fontUrl: string): Promise<boolean> {
    try {
        const response = await fetch(fontUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        setGbkFontBytes(data);
        Module!.FS.writeFile(`/fonts/${GBK_FONT_FILE}`, data);
        return true;
    } catch (error) {
        console.warn('Unable to load the GBK fallback font:', error);
        return false;
    }
}
