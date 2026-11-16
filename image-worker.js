// 画像処理用 Web Worker. Canvasから渡された画素を専用スレッドで変換する.
// 処理の流れ: 明るさ・コントラスト・グレースケール -> 減色(メディアンカット) -> ディザリング.

const SAMPLE_LIMIT = 12000;

// Ordered ディザリング用の 4x4 ベイヤー行列.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 誤差拡散の係数. 各要素は [dx, dy, 重み].
const KERNELS = {
  floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

// 明るさ・コントラスト・グレースケールを画素列へ直接適用する. 完全透明の画素は変更しない.
function adjustColors(data, { brightness, contrast, grayscale }) {
  const gain = contrast / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    for (let c = 0; c < 3; c += 1) {
      data[i + c] = clamp((data[i + c] - 128) * gain + 128 + brightness);
    }
    if (grayscale) {
      const gray = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
  }
}

// メディアンカットでパレットを作る. 戻り値は [r, g, b, r, g, b, ...] の平坦な配列.
function buildPalette(data, count) {
  const stride = Math.max(1, Math.floor(data.length / 4 / SAMPLE_LIMIT));
  const pixels = [];
  for (let i = 0; i < data.length; i += 4 * stride) {
    if (data[i + 3]) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) pixels.push([0, 0, 0]);

  const boxes = [pixels];
  while (boxes.length < count) {
    // 最も色幅が広い箱とそのチャンネルを探す. 色幅が0の箱は分割しない.
    let target = -1;
    let channel = 0;
    let range = 0;
    for (let b = 0; b < boxes.length; b += 1) {
      const box = boxes[b];
      if (box.length < 2) continue;
      const min = [255, 255, 255];
      const max = [0, 0, 0];
      for (const pixel of box) {
        for (let c = 0; c < 3; c += 1) {
          if (pixel[c] < min[c]) min[c] = pixel[c];
          if (pixel[c] > max[c]) max[c] = pixel[c];
        }
      }
      let widest = 0;
      for (let c = 1; c < 3; c += 1) {
        if (max[c] - min[c] > max[widest] - min[widest]) widest = c;
      }
      const spread = max[widest] - min[widest];
      if (spread > range) {
        target = b;
        channel = widest;
        range = spread;
      }
    }
    if (target < 0) break;

    const box = boxes.splice(target, 1)[0].sort((a, b) => a[channel] - b[channel]);
    const middle = Math.floor(box.length / 2);
    boxes.push(box.slice(0, middle), box.slice(middle));
  }

  const palette = [];
  for (const box of boxes) {
    const sum = [0, 0, 0];
    for (const pixel of box) {
      sum[0] += pixel[0];
      sum[1] += pixel[1];
      sum[2] += pixel[2];
    }
    palette.push(Math.round(sum[0] / box.length), Math.round(sum[1] / box.length), Math.round(sum[2] / box.length));
  }
  return palette;
}

// 最も近いパレット色の先頭位置(平坦配列上の添字)を返す.
function nearestIndex(r, g, b, palette) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 3) {
    const dr = r - palette[i];
    const dg = g - palette[i + 1];
    const db = b - palette[i + 2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// 減色とディザリング. 透明画素は処理せず, 誤差も透明画素へは拡散しない.
// 結果は渡された画素列へ直接書き込む. 誤差拡散は画像全体の作業配列を持たず, 処理中の行と先の行だけを保持する.
function quantize(data, width, height, { colors, method }) {
  const palette = buildPalette(data, colors);
  const kernel = KERNELS[method] || null;
  const ordered = method === 'ordered';
  const reach = kernel ? Math.max(...kernel.map((entry) => entry[1])) : 0;
  const ringSize = reach + 1;
  const rows = kernel ? Array.from({ length: ringSize }, () => new Float32Array(width * 3)) : null;

  // y 行目の元の画素値を, 作業用の行へ読み込む.
  const loadRow = (y) => {
    if (y >= height) return;
    const row = rows[y % ringSize];
    for (let x = 0, i = y * width * 4; x < width; x += 1, i += 4) {
      row[x * 3] = data[i];
      row[x * 3 + 1] = data[i + 1];
      row[x * 3 + 2] = data[i + 2];
    }
  };
  if (kernel) {
    for (let y = 0; y <= reach; y += 1) loadRow(y);
  }

  for (let y = 0; y < height; y += 1) {
    // y 行目の処理に入る時点で, reach 行先まで読み込み済みにする. 使い終わった行の枠を再利用する.
    if (kernel && y > 0) loadRow(y + reach);
    const row = kernel ? rows[y % ringSize] : null;

    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (!data[i + 3]) {
        data[i] = data[i + 1] = data[i + 2] = 0;
        continue;
      }

      let r;
      let g;
      let b;
      if (kernel) {
        r = clamp(row[x * 3]);
        g = clamp(row[x * 3 + 1]);
        b = clamp(row[x * 3 + 2]);
      } else {
        r = data[i];
        g = data[i + 1];
        b = data[i + 2];
      }
      if (ordered) {
        const threshold = (BAYER[y % 4][x % 4] - 7.5) * 5;
        r = clamp(r + threshold);
        g = clamp(g + threshold);
        b = clamp(b + threshold);
      }

      const p = nearestIndex(r, g, b, palette);
      data[i] = palette[p];
      data[i + 1] = palette[p + 1];
      data[i + 2] = palette[p + 2];

      if (!kernel) continue;
      const errR = r - palette[p];
      const errG = g - palette[p + 1];
      const errB = b - palette[p + 2];
      for (let k = 0; k < kernel.length; k += 1) {
        const entry = kernel[k];
        const nx = x + entry[0];
        const ny = y + entry[1];
        if (nx < 0 || nx >= width || ny >= height) continue;
        if (!data[(ny * width + nx) * 4 + 3]) continue;
        const target = rows[ny % ringSize];
        target[nx * 3] += errR * entry[2];
        target[nx * 3 + 1] += errG * entry[2];
        target[nx * 3 + 2] += errB * entry[2];
      }
    }
  }
  return palette.length / 3;
}

self.onmessage = ({ data: { buffer, width, height, settings } }) => {
  const data = new Uint8ClampedArray(buffer);
  adjustColors(data, settings);
  const paletteCount = settings.quantize ? quantize(data, width, height, settings) : 0;
  self.postMessage({ buffer: data.buffer, paletteCount }, [data.buffer]);
};
