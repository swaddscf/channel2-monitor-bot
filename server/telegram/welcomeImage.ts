import { deflateSync } from "node:zlib";

/**
 * Self-contained PNG banner generator (no external dependencies).
 * Draws an attractive gradient banner with decorative circles and a large
 * download icon. Returns a PNG Buffer ready to be sent as a Telegram photo.
 */

const WIDTH = 800;
const HEIGHT = 450;

type Rgba = { r: number; g: number; b: number; a: number };

function hexColor(hex: string): Rgba {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: 1,
  };
}

function createCanvas() {
  const data = new Float64Array(WIDTH * HEIGHT * 4);
  return {
    put(x: number, y: number, color: Rgba) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
      const index = (py * WIDTH + px) * 4;
      const srcA = color.a;
      if (srcA <= 0) return;
      const dstA = data[index + 3];
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) return;
      data[index] = (color.r * srcA + data[index] * dstA * (1 - srcA)) / outA;
      data[index + 1] = (color.g * srcA + data[index + 1] * dstA * (1 - srcA)) / outA;
      data[index + 2] = (color.b * srcA + data[index + 2] * dstA * (1 - srcA)) / outA;
      data[index + 3] = outA;
    },
    pixels() {
      return data;
    },
    fillRect(x: number, y: number, w: number, h: number, color: Rgba) {
      for (let py = Math.floor(y); py < Math.floor(y + h); py += 1) {
        for (let px = Math.floor(x); px < Math.floor(x + w); px += 1) {
          this.put(px, py, color);
        }
      }
    },
    fillCircle(cx: number, cy: number, radius: number, color: Rgba) {
      for (let py = Math.floor(cy - radius - 1); py <= cy + radius + 1; py += 1) {
        for (let px = Math.floor(cx - radius - 1); px <= cx + radius + 1; px += 1) {
          const dx = px - cx;
          const dy = py - cy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const edge = radius - 0.5;
          if (distance <= edge) {
            this.put(px, py, color);
          } else if (distance < radius + 0.5) {
            this.put(px, py, { ...color, a: color.a * (radius + 0.5 - distance) });
          }
        }
      }
    },
    fillTriangle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, color: Rgba) {
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
      const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      const sign = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) =>
        (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const point = { x: px + 0.5, y: py + 0.5 };
          const d1 = sign(point, a, b);
          const d2 = sign(point, b, c);
          const d3 = sign(point, c, a);
          const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
          const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
          if (!(hasNegative && hasPositive)) this.put(px, py, color);
        }
      }
    },
  };
}

function lerpColor(from: Rgba, to: Rgba, t: number): Rgba {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  };
}

function drawDownloadIcon(canvas: ReturnType<typeof createCanvas>, centerX: number, centerY: number, size: number, color: Rgba) {
  const shaftWidth = size * 0.18;
  const shaftTop = centerY - size * 0.42;
  const shaftBottom = centerY + size * 0.05;
  const headHeight = size * 0.3;
  const headHalf = size * 0.34;
  const trayY = centerY + size * 0.22;
  const trayHeight = size * 0.12;
  const trayHalf = size * 0.48;

  canvas.fillRect(centerX - shaftWidth / 2, shaftTop, shaftWidth, shaftBottom - shaftTop, color);
  canvas.fillTriangle(
    { x: centerX - headHalf, y: centerY },
    { x: centerX + headHalf, y: centerY },
    { x: centerX, y: centerY + headHeight },
    color,
  );
  canvas.fillRect(centerX - trayHalf, trayY, trayHalf * 2, trayHeight, color);
  canvas.fillRect(centerX - trayHalf, trayY + trayHeight, trayHalf * 2, size * 0.05, color);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width: number, height: number, pixels: Float64Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = Math.max(0, Math.min(255, Math.round(pixels[index])));
      raw[offset + 1] = Math.max(0, Math.min(255, Math.round(pixels[index + 1])));
      raw[offset + 2] = Math.max(0, Math.min(255, Math.round(pixels[index + 2])));
      raw[offset + 3] = Math.max(0, Math.min(255, Math.round(pixels[index + 3] * 255)));
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderWelcomeBanner(): Buffer {
  const canvas = createCanvas();
  const topLeft = hexColor("#7C3AED");
  const bottomRight = hexColor("#EC4899");
  const gradientFlashes = [hexColor("#6366F1"), hexColor("#F43F5E")];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const t = (x / WIDTH + y / HEIGHT) / 2;
      canvas.put(x, y, lerpColor(topLeft, bottomRight, t));
    }
  }

  const accent = hexColor("#A78BFA");
  const whiteSoft = { r: 255, g: 255, b: 255, a: 0.07 };
  const whiteSofter = { r: 255, g: 255, b: 255, a: 0.05 };
  const flashes = [
    [gradientFlashes[0], 60, 320, 340],
    [gradientFlashes[1], 720, 90, 260],
    [accent, 640, 400, 190],
  ] as const;
  for (const [color, cx, cy, radius] of flashes) {
    const highlight = { ...color, a: 0.1 };
    canvas.fillCircle(cx, cy, radius, highlight);
    canvas.fillCircle(cx, cy, radius * 0.7, { ...color, a: 0.07 });
  }

  for (let index = 0; index < 26; index += 1) {
    const px = (index * 137 + 61) % WIDTH;
    const py = (index * 89 + 23) % HEIGHT;
    const radius = 4 + ((index * 31) % 14);
    canvas.fillCircle(px, py, radius, index % 2 === 0 ? whiteSoft : whiteSofter);
  }

  const shadow = { r: 0, g: 0, b: 0, a: 0.18 };
  const iconColor = { r: 255, g: 255, b: 255, a: 0.96 };
  drawDownloadIcon(canvas, WIDTH / 2 - 8, HEIGHT / 2 - 8, 150, shadow);
  drawDownloadIcon(canvas, WIDTH / 2, HEIGHT / 2, 150, iconColor);

  return encodePng(WIDTH, HEIGHT, canvas.pixels());
}