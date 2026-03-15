#!/usr/bin/env node
/**
 * Generates src/icon.png (256×256) and src/tray-icon.png (16×16)
 * Uses only Node.js built-in modules — no external dependencies.
 *
 * Run: node scripts/gen-icon.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { deflateSync } = require('zlib');

// ---------------------------------------------------------------------------
// CRC32 (needed for PNG chunk integrity)
// ---------------------------------------------------------------------------
function buildCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const CRC_TABLE = buildCRC32Table();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// PNG builder — RGBA, 8-bit depth
// ---------------------------------------------------------------------------
function buildPNG(width, height, drawPixel) {
  // drawPixel(x, y) → [r, g, b, a]
  const rowStride = 1 + width * 4; // 1 filter byte + RGBA per pixel
  const raw = Buffer.alloc(height * rowStride, 0);

  for (let y = 0; y < height; y++) {
    raw[y * rowStride] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y);
      const offset = y * rowStride + 1 + x * 4;
      raw[offset]     = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Icon artwork
// ---------------------------------------------------------------------------
// Dark indigo background with a white rounded 'L'
function drawIcon256(x, y) {
  const size = 256;
  const bg   = [18, 18, 40, 255];  // dark indigo #121228
  const fg   = [255, 255, 255, 255]; // white

  const margin  = 52;
  const strokeW = 38;
  const bottom  = size - margin;
  const right   = size - margin;

  // Vertical stroke
  const inVert = x >= margin && x < margin + strokeW && y >= margin && y < bottom;
  // Horizontal stroke
  const inHorz = x >= margin && x < right && y >= bottom - strokeW && y < bottom;

  // Rounded corner radius on outer corners (simple circle test)
  const cornerR = 36;
  function inRoundedRect(cx, cy) {
    const dx = Math.max(0, Math.abs(cx - size / 2) - (size / 2 - cornerR));
    const dy = Math.max(0, Math.abs(cy - size / 2) - (size / 2 - cornerR));
    return dx * dx + dy * dy <= cornerR * cornerR;
  }

  if (!inRoundedRect(x, y)) return bg;
  if (inVert || inHorz) return fg;
  return bg;
}

// Monochrome 'L' for tray template icon (black on transparent)
function drawTray16(x, y) {
  const size    = 16;
  const margin  = 3;
  const strokeW = 3;
  const bottom  = size - margin;
  const right   = size - margin;

  const inVert = x >= margin && x < margin + strokeW && y >= margin && y < bottom;
  const inHorz = x >= margin && x < right && y >= bottom - strokeW && y < bottom;

  if (inVert || inHorz) return [0, 0, 0, 255];
  return [0, 0, 0, 0]; // transparent
}

// ---------------------------------------------------------------------------
// ICNS builder — wraps a PNG into an Apple Icon Image container
// ic08 = 256×256 PNG
// ---------------------------------------------------------------------------
function buildICNS(pngBuf) {
  const type   = Buffer.from('ic08', 'ascii'); // 256×256
  const length = Buffer.alloc(4);
  length.writeUInt32BE(8 + pngBuf.length, 0);

  const iconSet = Buffer.concat([type, length, pngBuf]);

  const magic  = Buffer.from('icns', 'ascii');
  const total  = Buffer.alloc(4);
  total.writeUInt32BE(8 + iconSet.length, 0);

  return Buffer.concat([magic, total, iconSet]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const SRC = path.join(__dirname, '..', 'src');

console.log('Generating icons…');

const icon256 = buildPNG(256, 256, drawIcon256);
fs.writeFileSync(path.join(SRC, 'icon.png'), icon256);
console.log('  ✔  src/icon.png  (256×256)');

const icns = buildICNS(icon256);
fs.writeFileSync(path.join(SRC, 'icon.icns'), icns);
console.log('  ✔  src/icon.icns (wraps 256×256 PNG as ic08)');

const tray16 = buildPNG(16, 16, drawTray16);
fs.writeFileSync(path.join(SRC, 'tray-icon.png'), tray16);
console.log('  ✔  src/tray-icon.png (16×16 template)');

console.log('Done.');
