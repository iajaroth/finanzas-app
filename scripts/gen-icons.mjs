// Genera iconos PNG (192 y 512) para el manifest PWA sin dependencias nativas
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / (size - 1), y / (size - 1), Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.14));
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    px.copy(raw, y * (size + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// mezcla colores en el espacio RGB
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
const BG = [18, 19, 42];
const CYAN = [0, 225, 253];
const MAGENTA = [255, 44, 223];
const GREEN = [0, 255, 91];

function draw(u, v, corner) {
  const x = u, y = v;
  // fondo con glow magenta arriba a la derecha
  const d1 = Math.hypot(x - 0.85, y - 0.1);
  const glow = Math.max(0, 1 - d1 * 1.7) * 0.2;
  let c = mix(BG, MAGENTA, glow);
  // anillo con degradado cyan→azul (izq→der)
  const dc = Math.hypot(x - 0.5, y - 0.5);
  const ring = Math.abs(dc - 0.3) < 0.045 ? 1 : 0;
  if (ring) c = mix(CYAN, [45, 39, 255], x);
  // barras (gráfico)
  const bars = [
    [0.385, 0.56, 0.72],
    [0.475, 0.44, 0.78],
    [0.565, 0.60, 0.72],
  ];
  for (const [bx, by, bw] of bars) {
    if (x > bx && x < bx + bw * 0.4 && y > by && y < 0.78) c = GREEN;
  }
  return [c[0], c[1], c[2], corner < 1 ? 255 : 255];
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png(size, draw));
}
console.log('iconos generados en', outDir);
