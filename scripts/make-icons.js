// scripts/make-icons.js (T1) — the app icon as a PNG, written with node:zlib only (contract section 4.30.3).
// Used by scripts/serve.js (GET /icons/<name>.png, generated in memory) and by scripts/build.js (dist/icons/*.png).
// There is no glyph: system fonts are not available to a PNG writer; the in-page favicon carries the character.
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const NAVY = [0x10, 0x1a, 0x33];        // #101a33, the rounded square
const VERMILION = [0xd8, 0x40, 0x2f];   // #d8402f, the disc
const GOLD = [0xff, 0xd9, 0x8a];        // #ffd98a, the rim of the disc

const DISC_RADIUS = 0.36;               // of the edge length; the rim is its outer part
const RIM_WIDTH = 0.04;                 // of the edge length
const CORNER_RADIUS = 0.18;             // of the edge length; smaller than the iOS icon mask, so iOS never shows a bare corner
const SAMPLES = 3;                      // 3x3 supersampling
const MAX_SIZE = 4096;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 as PNG uses it (ISO 3309, polynomial 0xedb88320).
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit value
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * One PNG chunk: length, type, data, CRC over type and data.
 * @param {string} type four ASCII letters
 * @param {Uint8Array} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * The RGBA pixels of the icon, row by row, each row led by the filter byte 0.
 * Every pixel is the average of 3x3 sample points; a sample is classified by distance tests only.
 * @param {number} size
 * @returns {Buffer}
 */
function scanlines(size) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  const centre = size / 2;
  const corner = CORNER_RADIUS * size;
  const disc = DISC_RADIUS * size;
  const core = (DISC_RADIUS - RIM_WIDTH) * size;
  const corner2 = corner * corner, disc2 = disc * disc, core2 = core * core;
  const total = SAMPLES * SAMPLES;

  // Per sample coordinate along one axis: how far it lies inside the corner zone (0 on the straight part of an edge)
  // and its offset from the centre. Both axes share the table because the picture is symmetric.
  const count = size * SAMPLES;
  const inset = new Float64Array(count);
  const offset = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const p = (k + 0.5) / SAMPLES;
    inset[k] = Math.max(corner - p, p - (size - corner), 0);
    offset[k] = p - centre;
  }

  for (let y = 0; y < size; y++) {
    let at = y * stride + 1;                       // raw[y * stride] stays 0: filter type "None"
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, opaque = 0;
      for (let j = 0; j < SAMPLES; j++) {
        const sy = y * SAMPLES + j;
        for (let i = 0; i < SAMPLES; i++) {
          const sx = x * SAMPLES + i;
          if (inset[sx] * inset[sx] + inset[sy] * inset[sy] > corner2) continue;      // outside the rounded square
          const d2 = offset[sx] * offset[sx] + offset[sy] * offset[sy];
          const colour = d2 <= core2 ? VERMILION : d2 <= disc2 ? GOLD : NAVY;
          r += colour[0]; g += colour[1]; b += colour[2]; opaque++;
        }
      }
      if (opaque > 0) {
        raw[at] = Math.round(r / opaque);
        raw[at + 1] = Math.round(g / opaque);
        raw[at + 2] = Math.round(b / opaque);
        raw[at + 3] = Math.round(255 * opaque / total);
      }
      at += 4;
    }
  }
  return raw;
}

/**
 * A PNG of the app icon (rounded dark-navy square with a vermilion disc and a gold rim).
 * Sizes used: 180 (apple-touch-icon.png), 192, 512.
 * @param {number} size edge length in pixels
 * @returns {Buffer}
 */
export function makeIcon(size) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
    throw new RangeError(`makeIcon: size must be an integer from 1 to ${MAX_SIZE}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);      // width
  header.writeUInt32BE(size, 4);      // height
  header[8] = 8;                      // bit depth
  header[9] = 6;                      // colour type: RGBA
  header[10] = 0;                     // compression: deflate
  header[11] = 0;                     // filter method: adaptive (every row uses type 0)
  header[12] = 0;                     // no interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
