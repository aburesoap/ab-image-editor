// 画像レイヤー. 元画像の上に重ねる別の画像. 枠(x1, y1, x2, y2)と回転で置き, 図形と同じハンドルで動かす.
// 画像そのもの(素材)は imageAssets に1度だけ持ち, レイヤーは素材の番号(imageId)だけを持つ.
// 履歴にはレイヤー(番号)だけが残るので, 元に戻しても画像を何度も複製しない.

import { EMBED_MAX_BYTES, IMAGE_TYPES } from './constants.js';
import { mapPointToCanvas } from './geometry.js';

// 素材の一覧. 番号 → { image, blob, name }.
export const imageAssets = new Map();
let nextAssetNumber = 1;

// 画像のファイルを読み込み, 素材として登録する. 登録できたら番号, できなければ null で解決する.
export function registerImageAsset(blob, name) {
  if (!blob || !IMAGE_TYPES.includes(blob.type) || blob.size > EMBED_MAX_BYTES) return Promise.resolve(null);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve) => {
    image.onload = () => {
      const id = `img${nextAssetNumber}`;
      nextAssetNumber += 1;
      imageAssets.set(id, { image, blob, name: String(name || '').slice(0, 200), url });
      resolve(id);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

// 使っていない素材を捨てる. keep は残す番号の一覧(空なら, すべて捨てる).
export function pruneImageAssets(keep = []) {
  const used = new Set(keep);
  [...imageAssets.keys()].forEach((id) => {
    if (used.has(id)) return;
    URL.revokeObjectURL(imageAssets.get(id).url);
    imageAssets.delete(id);
  });
}

export const imageAsset = (id) => imageAssets.get(id) || null;

// 新しく置く画像の枠(0〜1). 画像の大きさ(px)のまま置き, 元画像の80%に収まらなければ縮める.
// W, H は元画像(回転後)の大きさ(px). offset は, 続けて置くときに少しずつずらす量.
export function initialImageFrame(image, W, H, offset = 0) {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const scale = Math.min(1, (W * 0.8) / iw, (H * 0.8) / ih);
  const hw = (iw * scale) / W / 2;
  const hh = (ih * scale) / H / 2;
  const cx = 0.5 + offset;
  const cy = 0.5 + offset;
  return { x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh };
}

// 画像レイヤーを描く. 枠の向き(x2 < x1 なら左右反転, y2 < y1 なら上下反転)と回転を反映する.
export function drawImageLayer(ctx, width, height, obj, cropRect) {
  const asset = imageAsset(obj.imageId);
  if (!asset) return;
  const a = mapPointToCanvas(obj.x1, obj.y1, width, height, cropRect);
  const b = mapPointToCanvas(obj.x2, obj.y2, width, height, cropRect);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < 0.5 || h < 0.5) return;
  ctx.save();
  ctx.globalAlpha = Number(obj.opacity ?? 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.rotate(Number(obj.rotation || 0) * Math.PI / 180);
  ctx.scale(b.x < a.x ? -1 : 1, b.y < a.y ? -1 : 1);
  ctx.drawImage(asset.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}
