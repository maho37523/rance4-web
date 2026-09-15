#!/usr/bin/env node
/**
 * Crop and magnify a region of a PNG, and report how much two PNGs differ.
 *
 * Diagnostic evidence for "the text is unreadable" needs to show the glyphs
 * themselves, and the interesting region is a few hundred pixels wide inside a
 * two-megapixel screenshot.  Node has zlib and nothing else here, so the PNG is
 * decoded by hand: 8-bit, non-interlaced, colour type 2 or 6, which is what a
 * Chrome screenshot and the game's own captures both are.
 *
 *   node tools/diag/pngcrop.mjs --in shot.png --out text.png \
 *       --crop 0,0.82,1,1 --scale 3
 *   node tools/diag/pngcrop.mjs --diff a.png b.png
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {deflateSync, inflateSync} from 'node:zlib';

function decodePng(buffer) {
    if (buffer.readUInt32BE(0) !== 0x89504e47)
        throw new Error('not a PNG');
    let offset = 8;
    let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
    const idat = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }
    if (bitDepth !== 8)
        throw new Error(`unsupported bit depth ${bitDepth}`);
    if (interlace !== 0)
        throw new Error('interlaced PNG not supported');
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
    if (!channels)
        throw new Error(`unsupported colour type ${colorType}`);

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    let position = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[position++];
        const line = raw.subarray(position, position + stride);
        position += stride;
        const target = pixels.subarray(y * stride, (y + 1) * stride);
        const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? target[x - channels] : 0;
            const up = previous ? previous[x] : 0;
            const upLeft = previous && x >= channels ? previous[x - channels] : 0;
            let value = line[x];
            switch (filter) {
                case 0: break;
                case 1: value = (value + left) & 0xff; break;
                case 2: value = (value + up) & 0xff; break;
                case 3: value = (value + ((left + up) >> 1)) & 0xff; break;
                case 4: {
                    const p = left + up - upLeft;
                    const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
                    const predictor = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
                    value = (value + predictor) & 0xff;
                    break;
                }
                default: throw new Error(`unknown filter ${filter}`);
            }
            target[x] = value;
        }
    }
    return {width, height, channels, pixels};
}

function encodePng(image) {
    const {width, height, channels, pixels} = image;
    const stride = width * channels;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
    const chunk = (type, data) => {
        const header = Buffer.alloc(8);
        header.writeUInt32BE(data.length, 0);
        header.write(type, 4, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
        return Buffer.concat([header, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = channels === 4 ? 6 : 2;
    chunks.push(chunk('IHDR', ihdr));
    chunks.push(chunk('IDAT', deflateSync(raw, {level: 9})));
    chunks.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(chunks);
}

let crcTable;
function crc32(buffer) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let crc = -1;
    for (const byte of buffer)
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return crc ^ -1;
}

function crop(image, box) {
    const x0 = Math.max(0, Math.round(box[0] * image.width));
    const y0 = Math.max(0, Math.round(box[1] * image.height));
    const x1 = Math.min(image.width, Math.round(box[2] * image.width));
    const y1 = Math.min(image.height, Math.round(box[3] * image.height));
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    const channels = image.channels;
    const pixels = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
        image.pixels.copy(pixels, y * width * channels,
            ((y0 + y) * image.width + x0) * channels,
            ((y0 + y) * image.width + x0 + width) * channels);
    }
    return {width, height, channels, pixels};
}

function magnify(image, factor) {
    const width = image.width * factor;
    const height = image.height * factor;
    const channels = image.channels;
    const pixels = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * channels;
            const target = (y * width + x) * channels;
            for (let c = 0; c < channels; c++)
                pixels[target + c] = image.pixels[source + c];
        }
    }
    return {width, height, channels, pixels};
}

const args = process.argv.slice(2);
const value = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (args.includes('--diff')) {
    const a = decodePng(readFileSync(args[args.indexOf('--diff') + 1]));
    const b = decodePng(readFileSync(args[args.indexOf('--diff') + 2]));
    if (a.width !== b.width || a.height !== b.height) {
        console.log(`DIFF: size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
        process.exit(0);
    }
    let differing = 0;
    let maxDelta = 0;
    for (let i = 0; i < a.pixels.length; i += a.channels) {
        const delta = Math.abs(a.pixels[i] - b.pixels[i]);
        if (delta > 8) differing++;
        if (delta > maxDelta) maxDelta = delta;
    }
    const total = a.width * a.height;
    console.log(`DIFF: ${differing} / ${total} pixels differ (${(differing / total * 100).toFixed(2)}%), max delta ${maxDelta}`);
} else {
    const input = decodePng(readFileSync(value('in')));
    const box = value('crop', '0,0,1,1').split(',').map(Number);
    const scale = Number(value('scale', '1'));
    const output = magnify(crop(input, box), scale);
    const out = value('out', 'crop.png');
    writeFileSync(out, encodePng(output));
    console.log(`${out}: ${output.width}x${output.height} from ${input.width}x${input.height} box=${box.join(',')} scale=${scale}`);
}
