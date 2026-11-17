// 元画像の描画. 元画像は「元画像のレイヤー」(type: 'base')として重ね順の中にあり, その順番で描く.

import { state } from './state.js';
import { sourceSize, toSourcePoint } from './geometry.js';

// 元画像のうち切り抜き範囲を, 向き(回転)を反映して描く.
export function drawSource(ctx, width, height, cropRect) {
  const image = state.sourceImage;
  const nw = image.naturalWidth;
  const nh = image.naturalHeight;
  if (!state.rotation) {
    ctx.drawImage(image, cropRect.x * nw, cropRect.y * nh, cropRect.w * nw, cropRect.h * nh, 0, 0, width, height);
    return;
  }
  const { w: rw, h: rh } = sourceSize();
  ctx.save();
  // 回転後の画像の座標(px)から, 描画先の座標へ.
  ctx.scale(width / (cropRect.w * rw), height / (cropRect.h * rh));
  ctx.translate(-cropRect.x * rw, -cropRect.y * rh);
  // 元画像の座標(px)から, 回転後の画像の座標へ.
  if (state.rotation === 90) {
    ctx.translate(rw, 0);
    ctx.rotate(Math.PI / 2);
  } else if (state.rotation === 180) {
    ctx.translate(rw, rh);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, rh);
    ctx.rotate(-Math.PI / 2);
  }
  // 切り抜き範囲にあたる元画像の部分だけを描く.
  const a = toSourcePoint(cropRect.x, cropRect.y);
  const b = toSourcePoint(cropRect.x + cropRect.w, cropRect.y + cropRect.h);
  const sx = Math.min(a.x, b.x) * nw;
  const sy = Math.min(a.y, b.y) * nh;
  const sw = Math.max(1, Math.abs(b.x - a.x) * nw);
  const sh = Math.max(1, Math.abs(b.y - a.y) * nh);
  ctx.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}
