import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve("public/assets/sprites");
mkdirSync(OUT, { recursive: true });

const P = {
  transparent: [0, 0, 0, 0],
  outline: [35, 28, 25, 255],
  deep: [58, 42, 34, 255],
  soil0: [128, 91, 57, 255],
  soil1: [143, 103, 63, 255],
  soil2: [156, 115, 70, 255],
  soilHi: [184, 139, 82, 255],
  dust: [194, 151, 94, 255],
  steel0: [42, 49, 48, 255],
  steel1: [67, 79, 77, 255],
  steel2: [104, 116, 109, 255],
  steelHi: [166, 168, 146, 255],
  teal0: [41, 71, 68, 255],
  teal1: [56, 105, 97, 255],
  teal2: [87, 132, 117, 255],
  rust0: [91, 46, 37, 255],
  rust1: [139, 66, 48, 255],
  rust2: [185, 94, 58, 255],
  copper: [201, 112, 60, 255],
  verdigris: [74, 130, 105, 255],
  amber0: [163, 104, 39, 255],
  amber: [233, 174, 62, 255],
  amberHi: [255, 217, 104, 255],
  red: [193, 65, 50, 255],
  green: [112, 164, 83, 255],
  blue0: [35, 57, 78, 255],
  blue1: [52, 91, 121, 255],
  blueHi: [100, 143, 158, 255],
  shadow: [38, 28, 26, 130],
};

class Image {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }
  pixel(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    this.data.set(color, index);
  }
  rect(x, y, width, height, color) {
    for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) this.pixel(px, py, color);
  }
  line(x0, y0, x1, y1, color, width = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.rect(x0 - Math.floor(width / 2), y0 - Math.floor(width / 2), width, width, color);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }
  polygon(points, color) {
    const minY = Math.floor(Math.min(...points.map((point) => point[1])));
    const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
    for (let y = minY; y <= maxY; y += 1) {
      const intersections = [];
      for (let index = 0; index < points.length; index += 1) {
        const [x1, y1] = points[index];
        const [x2, y2] = points[(index + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index < intersections.length; index += 2) {
        const end = intersections[index + 1];
        if (end === undefined) continue;
        for (let x = Math.ceil(intersections[index]); x <= Math.floor(end); x += 1) this.pixel(x, y, color);
      }
    }
  }
  outline(points, color, width = 1) {
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      this.line(a[0], a[1], b[0], b[1], color, width);
    }
  }
  ellipse(cx, cy, rx, ry, color) {
    for (let y = -ry; y <= ry; y += 1) {
      const span = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      this.rect(cx - span, cy + y, span * 2 + 1, 1, color);
    }
  }
  blit(source, dx, dy) {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const si = (y * source.width + x) * 4;
        const alpha = source.data[si + 3];
        if (!alpha) continue;
        const di = ((dy + y) * this.width + dx + x) * 4;
        if (dx + x < 0 || dy + y < 0 || dx + x >= this.width || dy + y >= this.height) continue;
        if (alpha === 255) {
          this.data.set(source.data.subarray(si, si + 4), di);
        } else {
          const a = alpha / 255;
          for (let channel = 0; channel < 3; channel += 1) {
            this.data[di + channel] = Math.round(source.data[si + channel] * a + this.data[di + channel] * (1 - a));
          }
          this.data[di + 3] = Math.min(255, alpha + this.data[di + 3]);
        }
      }
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), data.length + 8);
  return output;
}

function png(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < image.height; y += 1) {
    rows.push(Buffer.from([0]), Buffer.from(image.data.buffer, y * image.width * 4, image.width * 4));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeSheet(name, frames) {
  const sheet = new Image(frames[0].width * frames.length, frames[0].height);
  frames.forEach((frame, index) => sheet.blit(frame, index * frame.width, 0));
  const path = resolve(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(sheet));
  console.log(`${name}: ${sheet.width}x${sheet.height}`);
}

function diamond(image, cx, cy, width, height, fill, outline = P.outline) {
  const points = [[cx, cy - height / 2], [cx + width / 2, cy], [cx, cy + height / 2], [cx - width / 2, cy]];
  image.polygon(points, fill);
  image.outline(points, outline, 1);
}

function terrainFrame(variant) {
  const image = new Image(96, 48);
  const fills = [P.soil1, P.soil0, P.soil2, [136, 94, 58, 255], [150, 106, 65, 255], [124, 86, 55, 255]];
  diamond(image, 48, 24, 94, 46, fills[variant], P.deep);
  image.line(1, 24, 48, 47, [87, 59, 42, 255]);
  image.line(48, 47, 94, 24, [101, 68, 43, 255]);
  for (let index = 0; index < 18; index += 1) {
    const x = 7 + ((index * 29 + variant * 17) % 82);
    const y = 7 + ((index * 13 + variant * 7) % 33);
    if (Math.abs(x - 48) / 48 + Math.abs(y - 24) / 24 < 0.88) {
      image.pixel(x, y, index % 3 === 0 ? P.soilHi : P.deep);
      if (index % 5 === 0) image.pixel(x + 1, y, P.dust);
    }
  }
  if (variant === 2) image.line(34, 20, 45, 23, P.deep);
  if (variant === 3) image.rect(65, 27, 4, 2, P.soilHi);
  if (variant === 4) { image.pixel(26, 29, P.dust); image.pixel(27, 29, P.dust); }
  if (variant === 5) image.line(53, 14, 59, 18, [99, 66, 44, 255]);
  return image;
}

function decalFrame(kind) {
  const image = new Image(96, 48);
  if (kind === 0) {
    image.ellipse(48, 25, 30, 10, [52, 35, 30, 90]);
    image.ellipse(48, 24, 21, 7, [39, 31, 29, 130]);
    for (const [x, y] of [[24, 24], [31, 15], [65, 16], [72, 27], [50, 35]]) image.rect(x, y, 3, 2, P.outline);
  }
  if (kind === 1) {
    image.line(34, 18, 45, 23, P.deep); image.line(45, 23, 58, 20, P.deep); image.line(45, 23, 51, 31, P.deep);
  }
  if (kind === 2) {
    image.polygon([[30, 27], [35, 21], [42, 25], [40, 31]], P.steel1);
    image.outline([[30, 27], [35, 21], [42, 25], [40, 31]], P.outline);
    image.polygon([[56, 20], [61, 17], [66, 22], [61, 25]], P.deep);
  }
  if (kind === 3) {
    for (let index = 0; index < 5; index += 1) {
      image.rect(26 + index * 10, 19 + index * 2, 5, 2, [64, 46, 36, 170]);
      image.rect(31 + index * 10, 28 - index * 2, 5, 2, [64, 46, 36, 170]);
    }
  }
  if (kind === 4) {
    image.line(35, 15, 35, 31, P.steel0, 2); image.rect(30, 15, 10, 5, P.amber); image.rect(32, 16, 6, 1, P.outline);
    image.line(64, 20, 64, 34, P.steel0, 2); image.rect(61, 20, 7, 4, P.red);
  }
  if (kind === 5) {
    diamond(image, 49, 25, 30, 14, P.steel1); image.rect(45, 21, 8, 5, P.steel0);
    image.pixel(38, 24, P.amber); image.pixel(60, 26, P.amber);
  }
  if (kind === 6) {
    image.line(24, 16, 67, 32, P.outline, 3); image.line(24, 15, 67, 31, P.copper, 1);
  }
  if (kind === 7) {
    for (const [x, y] of [[27, 24], [33, 19], [43, 28], [53, 17], [61, 25], [68, 28]]) image.pixel(x, y, P.dust);
  }
  return image;
}

function panel(image, x, y, width, height, topColor = P.blue1) {
  image.rect(x - 1, y - 1, width + 2, height + 2, P.outline);
  image.rect(x, y, width, height, topColor);
  for (let px = x + 4; px < x + width; px += 7) image.line(px, y + 2, px, y + height - 3, P.blueHi);
  image.line(x, y, x + width - 1, y, P.steelHi);
}

function seedFrame(kind) {
  const image = new Image(96, 96);
  const move = kind === 8 ? 2 : kind === 7 ? -1 : 0;
  image.ellipse(48, 82, 24, 7, P.shadow);
  image.line(37, 69, 32 + move, 82, P.outline, 5);
  image.line(59, 69, 64 - move, 82, P.outline, 5);
  image.rect(27 + move, 80, 13, 4, P.steel0);
  image.rect(57 - move, 80, 13, 4, P.steel0);
  const solarLevel = kind >= 1 && kind <= 6 ? (kind <= 4 ? kind : 4) : 0;
  if (solarLevel > 0) {
    const extension = [0, 8, 15, 23, 25][solarLevel];
    image.line(39, 48, 35 - extension, 40, P.steel1, 3);
    image.line(57, 48, 61 + extension, 40, P.steel1, 3);
    panel(image, 31 - extension, 30, Math.max(5, extension), 17);
    panel(image, 65, 30, Math.max(5, extension), 17);
  }
  image.polygon([[31, 49], [48, 40], [66, 49], [48, 59]], P.steel2);
  image.outline([[31, 49], [48, 40], [66, 49], [48, 59]], P.outline, 2);
  image.polygon([[31, 49], [48, 59], [48, 75], [31, 65]], P.teal0);
  image.polygon([[66, 49], [48, 59], [48, 75], [66, 65]], P.teal1);
  image.outline([[31, 49], [48, 59], [48, 75], [31, 65]], P.outline, 2);
  image.outline([[66, 49], [48, 59], [48, 75], [66, 65]], P.outline, 2);
  image.rect(42, 53, 12, 8, P.amber0);
  image.rect(44, 54, 8, 3, kind === 15 ? P.red : kind === 5 || kind === 6 ? P.green : P.amber);
  image.pixel(34, 52, P.steelHi);
  image.pixel(62, 52, P.teal2);
  if (kind === 9 || kind === 10) {
    image.line(31, 56, kind === 10 ? 8 : 14, kind === 10 ? 68 : 62, P.steel1, 4);
    image.rect(kind === 10 ? 5 : 11, kind === 10 ? 66 : 60, 9, 7, P.outline);
    image.rect(kind === 10 ? 7 : 13, kind === 10 ? 67 : 61, 5, 3, P.amber);
  }
  if (kind === 11 || kind === 12) {
    image.rect(38, 59, 20, 13, P.outline);
    image.rect(40, 60, 16, 9, kind === 12 ? P.amberHi : P.rust2);
    image.rect(43, 54, 10, 3, P.steel0);
    if (kind === 12) { image.pixel(60, 56, P.dust); image.pixel(63, 52, P.dust); }
  }
  if (kind === 13 || kind === 14) {
    image.line(64, 55, kind === 14 ? 81 : 75, kind === 14 ? 68 : 61, P.steel1, 4);
    image.rect(kind === 14 ? 79 : 73, kind === 14 ? 66 : 59, 8, 8, P.outline);
    image.pixel(kind === 14 ? 87 : 81, kind === 14 ? 65 : 58, P.amberHi);
  }
  if (kind === 16) {
    image.rect(29, 38, 4, 4, P.amberHi); image.rect(64, 38, 4, 4, P.amberHi);
  }
  if (kind === 17) {
    image.rect(31, 44, 35, 26, P.teal1);
    image.rect(42, 49, 13, 8, P.blueHi);
    image.rect(35, 69, 9, 9, P.steel0);
    image.rect(54, 69, 9, 9, P.steel0);
  }
  return image;
}

function rock(image, cx, cy, scale, base, high) {
  const points = [[cx - scale, cy + 4], [cx - scale + 3, cy - scale], [cx + 2, cy - scale - 3], [cx + scale, cy], [cx + scale - 2, cy + 7], [cx - 4, cy + 8]];
  image.polygon(points, base); image.outline(points, P.outline, 2);
  image.polygon([[cx - scale + 3, cy - scale], [cx + 2, cy - scale - 3], [cx, cy + 1], [cx - 5, cy + 2]], high);
}

function depositFrame(kind, depletion) {
  const image = new Image(96, 96);
  image.ellipse(48, 80, 32 - depletion * 5, 8, P.shadow);
  const base = kind === "iron" ? P.rust1 : P.teal1;
  const high = kind === "iron" ? P.rust2 : P.copper;
  const count = 4 - depletion;
  const specs = [[31, 68, 13], [49, 57, 17], [66, 70, 11], [48, 73, 12]];
  for (let index = 0; index < count; index += 1) rock(image, ...specs[index], base, high);
  if (depletion === 2) {
    image.rect(37, 77, 22, 3, P.deep);
    image.pixel(60, 74, high);
  }
  return image;
}

function storageBase(image) {
  const points = [[18, 70], [96, 37], [174, 70], [96, 104]];
  image.polygon(points, P.steel0); image.outline(points, P.outline, 3);
  image.line(19, 70, 96, 101, P.steel2, 2);
  image.line(96, 101, 173, 70, P.teal0, 2);
  for (const x of [48, 72, 96, 120, 144]) image.line(x, 55 + Math.abs(96 - x) * 0.42, x, 84 + Math.abs(96 - x) * 0.42, P.steel1);
  image.polygon([[18, 70], [42, 80], [30, 88], [8, 78]], P.amber0);
  image.outline([[18, 70], [42, 80], [30, 88], [8, 78]], P.outline, 2);
  image.rect(156, 68, 6, 10, P.outline); image.rect(158, 67, 3, 3, P.green);
}

function crate(image, x, y, ore = false) {
  image.polygon([[x, y], [x + 12, y - 5], [x + 24, y], [x + 12, y + 6]], P.steel2);
  image.polygon([[x, y], [x + 12, y + 6], [x + 12, y + 18], [x, y + 11]], P.steel0);
  image.polygon([[x + 24, y], [x + 12, y + 6], [x + 12, y + 18], [x + 24, y + 11]], P.teal0);
  image.outline([[x, y], [x + 12, y - 5], [x + 24, y], [x + 24, y + 11], [x + 12, y + 18], [x, y + 11]], P.outline, 2);
  if (ore) {
    image.rect(x + 6, y - 5, 5, 4, P.rust2); image.rect(x + 13, y - 7, 6, 5, P.rust1);
  }
}

function storageFrame(frame) {
  const image = new Image(192, 128);
  storageBase(image);
  if (frame <= 2) {
    const height = [10, 28, 44][frame];
    image.line(52, 78, 52, 78 - height, P.amber, 3);
    image.line(140, 78, 140, 78 - height, P.amber, 3);
    image.line(52, 78 - height, 140, 78 - height, P.amber, 3);
    if (frame >= 1) {
      image.line(52, 78, 140, 78 - height, P.steel2, 2);
      image.line(140, 78, 52, 78 - height, P.steel2, 2);
    }
    if (frame === 2) crate(image, 74, 55, true);
  }
  if (frame >= 4) {
    crate(image, 55, 65, true);
    crate(image, 91, 59, frame === 5);
    if (frame === 5) crate(image, 112, 70, true);
  }
  return image;
}

function supportBuildingFrame(kind) {
  const image = new Image(192, 128);
  storageBase(image);
  if (kind === 0) {
    image.rect(62, 48, 68, 35, P.teal0); image.rect(67, 42, 58, 10, P.steel2);
    image.rect(75, 45, 34, 4, P.blueHi); image.rect(119, 39, 6, 7, P.amber);
  }
  if (kind === 1) {
    image.polygon([[58, 73], [95, 51], [134, 70], [96, 90]], P.rust0);
    image.rect(80, 34, 30, 41, P.steel0); image.rect(87, 45, 17, 20, P.amber0);
    image.rect(112, 22, 17, 48, P.steel1); image.rect(116, 18, 9, 7, P.rust2);
  }
  if (kind === 2) {
    image.line(54, 79, 72, 36, P.steelHi, 7); image.line(139, 78, 119, 30, P.steelHi, 7);
    image.line(72, 36, 119, 30, P.teal1, 8); image.rect(82, 54, 30, 20, P.steel0);
    image.rect(92, 48, 10, 6, P.blueHi);
  }
  return image;
}

function cargoFrame(kind) {
  const image = new Image(32, 32);
  image.ellipse(16, 28, 11, 3, P.shadow);
  image.polygon([[4, 17], [16, 12], [28, 17], [16, 23]], P.steel1);
  image.polygon([[4, 17], [16, 23], [16, 29], [4, 23]], P.steel0);
  image.polygon([[28, 17], [16, 23], [16, 29], [28, 23]], P.teal0);
  image.outline([[4, 17], [16, 12], [28, 17], [28, 23], [16, 29], [4, 23]], P.outline);
  const colors = [P.rust2, P.verdigris, P.steelHi, P.copper];
  image.rect(9, 12, 6, 5, colors[kind]); image.rect(17, 10, 7, 6, colors[kind]);
  return image;
}

function effectFrame(frame) {
  const image = new Image(48, 48);
  if (frame <= 2) {
    const spread = 4 + frame * 5;
    image.rect(23, 25, 3, 3, P.amberHi);
    image.line(24, 24, 24 - spread, 18 - frame, P.rust2, 2);
    image.line(24, 24, 24 + spread, 15 + frame, P.dust, 2);
    image.pixel(15 - frame, 29, P.rust1); image.pixel(34 + frame, 27, P.soilHi);
  } else if (frame <= 4) {
    image.rect(17, 27, 15, 5, frame === 3 ? P.rust2 : P.amberHi);
    image.pixel(19, 22, P.dust); image.pixel(27, 18, P.dust); image.pixel(32, 23, P.rust2);
  } else {
    image.line(20, 26, 26, 18, P.amberHi, 2); image.line(26, 26, 20, 18, P.amber, 2);
    image.pixel(15, 24, P.dust); image.pixel(32, 19, P.amberHi);
  }
  return image;
}

function overlayFrame(kind) {
  const image = new Image(96, 48);
  const color = kind === 0 ? P.green : kind === 1 ? P.red : P.amberHi;
  const points = [[48, 2], [93, 24], [48, 46], [3, 24]];
  image.outline(points, color, kind === 2 ? 3 : 2);
  if (kind !== 2) {
    for (let index = 0; index < 4; index += 1) {
      const a = points[index]; const b = points[(index + 1) % 4];
      image.line(a[0], a[1], a[0] + (b[0] - a[0]) * 0.28, a[1] + (b[1] - a[1]) * 0.28, color, 3);
    }
  }
  return image;
}

function iconFrame(kind) {
  const image = new Image(16, 16);
  const c = P.amberHi;
  if (kind === 0) { image.rect(3, 8, 10, 6, c); image.line(3, 8, 8, 3, c, 2); image.line(13, 8, 8, 3, c, 2); }
  if (kind === 1) { image.rect(3, 3, 4, 10, c); image.rect(9, 3, 4, 10, c); image.line(5, 5, 11, 5, P.outline); }
  if (kind === 2) { image.rect(3, 2, 10, 12, c); image.rect(5, 5, 6, 1, P.outline); image.rect(5, 8, 6, 1, P.outline); }
  if (kind === 3) { image.rect(4, 3, 3, 10, c); image.rect(9, 3, 3, 10, c); }
  if (kind === 4) image.polygon([[4, 2], [13, 8], [4, 14]], c);
  if (kind === 5) { image.rect(3, 2, 10, 12, c); image.rect(5, 3, 6, 4, P.outline); image.rect(5, 9, 6, 4, P.outline); }
  if (kind === 6) { image.line(8, 1, 4, 8, c, 2); image.line(4, 8, 9, 8, c, 2); image.line(9, 8, 6, 15, c, 2); image.line(6, 15, 13, 6, c, 2); }
  if (kind === 7) { image.rect(4, 5, 8, 8, c); image.rect(6, 2, 4, 4, c); image.rect(2, 8, 2, 3, c); image.rect(12, 8, 2, 3, c); }
  if (kind === 8) { image.line(2, 8, 6, 4, c, 2); image.line(6, 4, 10, 4, c, 2); image.line(10, 4, 14, 8, c, 2); image.line(14, 8, 10, 12, c, 2); image.line(10, 12, 6, 12, c, 2); image.line(6, 12, 2, 8, c, 2); image.rect(7, 7, 3, 3, c); }
  if (kind === 9) { image.rect(2, 5, 5, 7, P.blueHi); image.rect(9, 5, 5, 7, P.blueHi); image.line(7, 8, 9, 8, c, 2); }
  if (kind === 10) { image.line(3, 13, 11, 5, c, 3); image.rect(9, 3, 5, 4, c); }
  if (kind === 11) { image.rect(3, 7, 10, 7, c); image.rect(5, 3, 6, 5, P.rust2); image.pixel(7, 1, P.dust); image.pixel(10, 2, P.dust); }
  return image;
}

writeSheet("terrain-soil.png", Array.from({ length: 6 }, (_, index) => terrainFrame(index)));
writeSheet("terrain-decals.png", Array.from({ length: 8 }, (_, index) => decalFrame(index)));
writeSheet("tile-overlays.png", Array.from({ length: 3 }, (_, index) => overlayFrame(index)));
writeSheet("seed-drone.png", Array.from({ length: 18 }, (_, index) => seedFrame(index)));
writeSheet("deposits.png", [
  depositFrame("iron", 0), depositFrame("iron", 1), depositFrame("iron", 2),
  depositFrame("copper", 0), depositFrame("copper", 1), depositFrame("copper", 2),
]);
writeSheet("field-storage.png", Array.from({ length: 6 }, (_, index) => storageFrame(index)));
writeSheet("support-buildings.png", Array.from({ length: 3 }, (_, index) => supportBuildingFrame(index)));
writeSheet("cargo.png", Array.from({ length: 4 }, (_, index) => cargoFrame(index)));
writeSheet("activity-fx.png", Array.from({ length: 6 }, (_, index) => effectFrame(index)));
writeSheet("ui-icons.png", Array.from({ length: 12 }, (_, index) => iconFrame(index)));
