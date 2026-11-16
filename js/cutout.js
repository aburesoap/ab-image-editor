// くり抜きの描画. くり抜き(cutout が true のオブジェクト)は自分では描かれず, 自分の形で「すぐ下のレイヤー1つ」に穴を開ける.
// 下のレイヤーを別のcanvasに描き, くり抜きを別のcanvas(型紙)に描いてから, 型紙の形だけを消して重ねる.
// くり抜きが続けて重なっているときは, すべて同じレイヤー(続きのすぐ下)をくり抜く.
// くり抜きの不透明度が低いと, 穴も薄く開く. 「窓」の描き方なら, 形の外側を消し, 内側だけを残す.

import { isEffectType } from './geometry.js';

// 作業用のcanvas. プレビューの大きさまでは使い回し, それより大きい書き出しでは使い終わったらすぐにメモリを返す.
const scratch = { layer: null, mask: null };
const CACHE_LIMIT = 4096 * 4096;

function workCanvas(key, width, height) {
  const temp = width * height > CACHE_LIMIT;
  let canvas = temp ? null : scratch[key];
  if (!canvas) {
    canvas = document.createElement('canvas');
    if (!temp) scratch[key] = canvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, temp };
}

function release(work) {
  if (work.temp) {
    work.canvas.width = 0;
    work.canvas.height = 0;
  }
}

// target をくり抜いて ctx へ重ねる. drawObject は render.js の描画関数(このモジュールから render.js を読み込まないよう, 受け取る).
export function drawWithCutouts(ctx, width, height, target, cutouts, cropRect, drawObject) {
  const layer = workCanvas('layer', width, height);
  // ぼかし・モザイクは下にあるものを写し取って加工するため, 下のレイヤーまでを描いた内容を先に写しておく.
  // 穴の部分は透明になり, 重ねたときに下の(加工されていない)内容が見える.
  if (isEffectType(target.type)) layer.ctx.drawImage(ctx.canvas, 0, 0);
  drawObject(layer.ctx, width, height, target, cropRect);
  const mask = workCanvas('mask', width, height);
  cutouts.forEach((cut) => drawObject(mask.ctx, width, height, cut, cropRect));
  layer.ctx.globalCompositeOperation = 'destination-out';
  layer.ctx.drawImage(mask.canvas, 0, 0);
  layer.ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer.canvas, 0, 0);
  release(mask);
  release(layer);
}
