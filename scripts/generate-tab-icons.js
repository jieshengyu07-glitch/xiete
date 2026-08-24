const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 81;
const SCALE = 4;
const CANVAS = SIZE * SCALE;
const outputDir = path.resolve(__dirname, "../weapp/assets/tab");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function createCanvas(hex) {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16));
  const high = new Uint8ClampedArray(CANVAS * CANVAS * 4);

  function paint(x, y) {
    if (x < 0 || y < 0 || x >= CANVAS || y >= CANVAS) return;
    const offset = (Math.floor(y) * CANVAS + Math.floor(x)) * 4;
    high[offset] = rgb[0];
    high[offset + 1] = rgb[1];
    high[offset + 2] = rgb[2];
    high[offset + 3] = 255;
  }

  function line(x1, y1, x2, y2, width = 4.5) {
    x1 *= SCALE; y1 *= SCALE; x2 *= SCALE; y2 *= SCALE; width *= SCALE;
    const radius = width / 2;
    const minX = Math.floor(Math.min(x1, x2) - radius);
    const maxX = Math.ceil(Math.max(x1, x2) + radius);
    const minY = Math.floor(Math.min(y1, y2) - radius);
    const maxY = Math.ceil(Math.max(y1, y2) + radius);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const projection = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
        const px = x1 + projection * dx;
        const py = y1 + projection * dy;
        if ((x - px) ** 2 + (y - py) ** 2 <= radius ** 2) paint(x, y);
      }
    }
  }

  function ring(cx, cy, radius, width = 4.5) {
    cx *= SCALE; cy *= SCALE; radius *= SCALE; width *= SCALE;
    const outer = radius + width / 2;
    const inner = radius - width / 2;
    for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y += 1) {
      for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x += 1) {
        const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2;
        if (distanceSquared <= outer ** 2 && distanceSquared >= inner ** 2) paint(x, y);
      }
    }
  }

  function curve(points, width = 4.5) {
    for (let index = 1; index < points.length; index += 1) {
      line(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], width);
    }
  }

  function downsample() {
    const pixels = Buffer.alloc(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        let alpha = 0;
        for (let sy = 0; sy < SCALE; sy += 1) {
          for (let sx = 0; sx < SCALE; sx += 1) {
            alpha += high[(((y * SCALE + sy) * CANVAS + x * SCALE + sx) * 4) + 3];
          }
        }
        const offset = (y * SIZE + x) * 4;
        pixels[offset] = rgb[0];
        pixels[offset + 1] = rgb[1];
        pixels[offset + 2] = rgb[2];
        pixels[offset + 3] = Math.round(alpha / (SCALE * SCALE));
      }
    }
    return pixels;
  }

  return { line, ring, curve, pixels: downsample };
}

function calendarIcon(color) {
  const canvas = createCanvas(color);
  canvas.line(21, 24, 60, 24);
  canvas.line(18, 29, 18, 61);
  canvas.line(63, 29, 63, 61);
  canvas.line(21, 66, 60, 66);
  canvas.line(18, 29, 23, 24);
  canvas.line(63, 29, 58, 24);
  canvas.line(18, 37, 63, 37, 4);
  canvas.line(28, 18, 28, 29, 4.5);
  canvas.line(53, 18, 53, 29, 4.5);
  return canvas.pixels();
}

function gradesIcon(color) {
  const canvas = createCanvas(color);
  canvas.line(24, 18, 52, 18);
  canvas.line(20, 22, 20, 63);
  canvas.line(24, 67, 57, 67);
  canvas.line(61, 31, 61, 63);
  canvas.line(20, 22, 24, 18);
  canvas.line(20, 63, 24, 67);
  canvas.line(57, 67, 61, 63);
  canvas.line(52, 18, 61, 27);
  canvas.line(52, 18, 52, 27);
  canvas.line(52, 27, 61, 27);
  canvas.line(29, 39, 52, 39, 4);
  canvas.line(29, 49, 52, 49, 4);
  canvas.line(29, 59, 44, 59, 4);
  return canvas.pixels();
}

function profileIcon(color) {
  const canvas = createCanvas(color);
  canvas.ring(40.5, 29, 10.5);
  const shoulder = [];
  for (let step = 0; step <= 24; step += 1) {
    const t = step / 24;
    const x = 18 + 45 * t;
    const y = 64 - 18 * Math.sin(Math.PI * t);
    shoulder.push([x, y]);
  }
  canvas.curve(shoulder);
  return canvas.pixels();
}

fs.mkdirSync(outputDir, { recursive: true });
const definitions = [
  ["timetable", calendarIcon],
  ["grades", gradesIcon],
  ["profile", profileIcon]
];

for (const [name, draw] of definitions) {
  fs.writeFileSync(path.join(outputDir, `${name}.png`), encodePng(draw("8a94a6")));
  fs.writeFileSync(path.join(outputDir, `${name}-active.png`), encodePng(draw("1677ff")));
}

console.log("Generated six 81x81 transparent tab icons in", outputDir);
