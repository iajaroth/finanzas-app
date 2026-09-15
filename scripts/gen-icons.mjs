// Genera iconos PWA + assets de Capacitor (icon 1024, splash 2732) con pngjs
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

const BG = [11, 12, 11];

// logo vectorial: anillo lima + 3 barras (lima, blanco, gris)
function drawIcon(fx, fy, S) {
  const px = fx * S, py = fy * S;
  const dist = Math.hypot(px - S / 2, py - S / 2);
  const ringHalf = S * 0.029;
  if (Math.abs(dist - S * 0.30) <= ringHalf) return [201, 245, 63, 255];
  const bars = [
    { x: 0.375, y: 0.42, h: 0.19, c: [201, 245, 63] },
    { x: 0.484, y: 0.34, h: 0.33, c: [255, 255, 255] },
    { x: 0.594, y: 0.47, h: 0.22, c: [154, 160, 150] },
  ];
  const w = S * 0.062, r = w / 2;
  for (const b of bars) {
    const x0 = b.x * S, y0 = b.y * S, x1 = x0 + w, y1 = y0 + b.h * S;
    const qx = Math.max(x0 + r, Math.min(px, x1 - r));
    const qy = Math.max(y0 + r, Math.min(py, y1 - r));
    if (Math.hypot(px - qx, py - qy) <= r) return [...b.c, 255];
  }
  return [...BG, 255];
}

function drawSplash(fx, fy, S) {
  const half = 0.17;
  if (fx < 0.5 - half || fx > 0.5 + half || fy < 0.5 - half || fy > 0.5 + half) return [...BG, 255];
  const lx = (fx - (0.5 - half)) / (half * 2);
  const ly = (fy - (0.5 - half)) / (half * 2);
  return drawIcon(lx, ly, 1024);
}

function makePng(size, draw) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / (size - 1), y / (size - 1), size);
      const idx = (size * y + x) << 2;
      png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makePng(size, (fx, fy) => drawIcon(fx, fy, size)));
}
fs.writeFileSync(path.join(assetsDir, 'icon.png'), makePng(1024, (fx, fy) => drawIcon(fx, fy, 1024)));
fs.writeFileSync(path.join(assetsDir, 'splash.png'), makePng(2732, (fx, fy) => drawSplash(fx, fy, 2732)));

// verificación: decodifica con pngjs
const check = PNG.sync.read(fs.readFileSync(path.join(assetsDir, 'icon.png')));
console.log('verificado:', check.width, 'x', check.height, '| iconos + assets generados');
