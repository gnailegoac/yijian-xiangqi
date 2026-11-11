import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { makeIcon } from '../../../scripts/make-icons.js';

// Contract section 4.30.3: a PNG (RGBA, zlib-deflated scanlines with filter 0, CRC32 computed in JS) of a rounded
// dark-navy square (#101a33) with a vermilion disc (radius 0.36·size, #d8402f, gold rim #ffd98a 0.04·size), drawn
// by distance test with 3x3 supersampling. Sizes: 180, 192, 512.
const NAVY = [0x10, 0x1a, 0x33, 255];
const VERMILION = [0xd8, 0x40, 0x2f, 255];
const GOLD = [0xff, 0xd9, 0x8a, 255];

/** CRC-32 bit by bit (no table): an implementation independent of the one in make-icons.js. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Splits a PNG into its chunks and checks the framing of every chunk on the way. */
function parsePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    const stored = png.readUInt32BE(at + 8 + length);
    chunks.push({ type, data, stored, computed: crc32(png.subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  assert.equal(at, png.length, 'the last chunk ends exactly at the end of the file');
  return chunks;
}

/** The decoded picture: pixel(x, y) -> [r, g, b, a]. */
function decode(png) {
  const chunks = parsePng(png);
  const size = chunks[0].data.readUInt32BE(0);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = 1 + size * 4;
  return {
    size, raw, stride,
    pixel: (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 5 + x * 4)],
  };
}

test('makeIcon(180) is a PNG with the right IHDR and a valid CRC', () => {
  const png = makeIcon(180);
  assert.ok(Buffer.isBuffer(png));
  const chunks = parsePng(png);
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  assert.equal(chunks.at(-1).data.length, 0);
  assert.ok(chunks.some((c) => c.type === 'IDAT'));
  for (const c of chunks) assert.equal(c.stored, c.computed, `CRC of ${c.type}`);

  const ihdr = chunks[0].data;
  assert.equal(ihdr.length, 13);
  assert.equal(ihdr.readUInt32BE(0), 180, 'width');
  assert.equal(ihdr.readUInt32BE(4), 180, 'height');
  assert.equal(ihdr[8], 8, 'bit depth');
  assert.equal(ihdr[9], 6, 'colour type RGBA');
  assert.equal(ihdr[10], 0, 'compression method');
  assert.equal(ihdr[11], 0, 'filter method');
  assert.equal(ihdr[12], 0, 'no interlace');
});

test('the scanlines are deflated RGBA rows, each with filter type 0', () => {
  const { raw, stride, size } = decode(makeIcon(180));
  assert.equal(raw.length, 180 * (1 + 180 * 4));
  for (let y = 0; y < size; y++) assert.equal(raw[y * stride], 0, `filter byte of row ${y}`);
});

test('the three sizes of the contract have their own width and height', () => {
  for (const size of [180, 192, 512]) {
    const chunks = parsePng(makeIcon(size));
    assert.equal(chunks[0].data.readUInt32BE(0), size);
    assert.equal(chunks[0].data.readUInt32BE(4), size);
    for (const c of chunks) assert.equal(c.stored, c.computed, `CRC of ${c.type} at ${size}`);
  }
});

test('the picture: navy square, vermilion disc of radius 0.36·size whose outer 0.04·size is the gold rim', () => {
  const { pixel } = decode(makeIcon(180));
  // centre (90, 90); the disc ends at 64.8 px, its vermilion core at 57.6 px
  assert.deepEqual(pixel(90, 90), VERMILION, 'centre');
  assert.deepEqual(pixel(90 + 50, 90), VERMILION, '50 px from the centre');
  assert.deepEqual(pixel(90, 90 - 56), VERMILION, '56 px above the centre');
  assert.deepEqual(pixel(90 + 61, 90), GOLD, '61 px from the centre: inside the rim');
  assert.deepEqual(pixel(90, 90 + 61), GOLD, '61 px below the centre: inside the rim');
  assert.deepEqual(pixel(90 - 61, 90), GOLD);
  assert.deepEqual(pixel(90 + 70, 90), NAVY, '70 px from the centre: outside the disc');
  assert.deepEqual(pixel(90, 3), NAVY, 'top edge, middle');
  assert.deepEqual(pixel(3, 90), NAVY, 'left edge, middle');
  assert.deepEqual(pixel(176, 90), NAVY, 'right edge, middle');
});

test('the square is rounded: the four corner pixels are fully transparent', () => {
  const { pixel } = decode(makeIcon(180));
  for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) assert.equal(pixel(x, y)[3], 0, `alpha at ${x},${y}`);
  assert.equal(pixel(90, 0)[3], 255, 'the middle of the top row is opaque');
  assert.equal(pixel(0, 90)[3], 255, 'the middle of the left column is opaque');
});

test('edges are anti-aliased by 3x3 supersampling', () => {
  const { pixel } = decode(makeIcon(180));
  // Pixel (154, 90) straddles the disc edge at x = 90 + 64.8. Its nine sample points sit at x offsets 64.17, 64.5,
  // 64.83 and y offsets 0.17, 0.5, 0.83 from the centre: the six with x offset <= 64.5 are within 64.8 px (gold),
  // the three at 64.83 are outside (navy). The pixel is the average of six gold and three navy samples.
  const expected = [0, 1, 2].map((ch) => Math.round((6 * GOLD[ch] + 3 * NAVY[ch]) / 9));
  assert.deepEqual(pixel(154, 90), [...expected, 255]);
  assert.deepEqual(expected, [175, 153, 109]);
});

test('the picture is symmetric and makeIcon is deterministic', () => {
  const png = makeIcon(192);
  assert.ok(png.equals(makeIcon(192)));
  const { pixel, size } = decode(png);
  for (let y = 0; y < size; y += 7) {
    for (let x = 0; x < size; x += 5) {
      assert.deepEqual(pixel(size - 1 - x, y), pixel(x, y), `mirror in x at ${x},${y}`);
      assert.deepEqual(pixel(x, size - 1 - y), pixel(x, y), `mirror in y at ${x},${y}`);
      assert.deepEqual(pixel(y, x), pixel(x, y), `transpose at ${x},${y}`);
    }
  }
});

test('a size that is not a positive integer is refused', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '180', undefined]) assert.throws(() => makeIcon(bad), RangeError);
});
