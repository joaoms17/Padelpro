// Generates the PWA icons offline (no native deps) using a minimal PNG encoder.
// Brand mark: cream tile with two overlapping coins (terracota + petróleo).
//   node scripts/gen-icons.mjs
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "public");
mkdirSync(OUT, { recursive: true });

const CREME = [0xf6, 0xf1, 0xea];
const TERRACOTA = [0xa6, 0x4b, 0x25];
const PETROLEO = [0x2e, 0x6b, 0x66];

// ---- minimal PNG encoder (RGBA, 8-bit) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels /* Uint8Array RGBA */) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression, filter, interlace = 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.subarray(y * stride, y * stride + stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size, coinScale) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * coinScale;
  // two coins offset from centre
  const off = r * 0.42;
  const coinA = { x: cx - off, y: cy - off * 0.5, col: PETROLEO };
  const coinB = { x: cx + off, y: cy + off * 0.5, col: TERRACOTA };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = CREME;
      // terracota coin drawn on top of petróleo
      if ((x - coinA.x) ** 2 + (y - coinA.y) ** 2 <= r * r) col = coinA.col;
      if ((x - coinB.x) ** 2 + (y - coinB.y) ** 2 <= r * r) col = coinB.col;
      const i = (y * size + x) * 4;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

const targets = [
  { file: "icon-192.png", size: 192, scale: 0.26 },
  { file: "icon-512.png", size: 512, scale: 0.26 },
  { file: "icon-512-maskable.png", size: 512, scale: 0.2 }, // smaller for safe zone
  { file: "apple-touch-icon.png", size: 180, scale: 0.26 },
];

for (const t of targets) {
  const png = encodePNG(t.size, draw(t.size, t.scale));
  writeFileSync(path.join(OUT, t.file), png);
  console.log("wrote", t.file, `${png.length} bytes`);
}

// favicon.svg — crisp vector version of the same mark
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#F6F1EA"/>
  <circle cx="40" cy="44" r="24" fill="#2E6B66"/>
  <circle cx="60" cy="56" r="24" fill="#A64B25"/>
</svg>`;
writeFileSync(path.join(OUT, "favicon.svg"), svg);
console.log("wrote favicon.svg");
