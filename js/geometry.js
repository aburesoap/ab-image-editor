// 寸法とオブジェクトの座標まわりの計算.

import { UI_REFERENCE_SIDE, previewSide } from './constants.js';
import { original } from './dom.js';
import { state } from './state.js';

export const isLineType = (type) => type === 'line' || type === 'arrow' || type === 'arrow2';
// 上下・左右が対称でない図形. 画像を90°回すときは, 枠の縦横を保ったまま角度を足す(rotate.js).
// ペン・蛍光ペンの線も, 描いた向きを保つため同じ扱いにする.
export const isOrientedType = (type) => ['triangle', 'star', 'balloon', 'blockarrow', 'pen', 'marker', 'image'].includes(type);
export const isText = (obj) => obj.type === 'text';
// 画像レイヤー(元画像の上に重ねた別の画像). 素材の番号(imageId)を持つ.
export const isImage = (obj) => obj.type === 'image';
// 下にあるものを加工して隠す範囲(ぼかし・モザイク). 色や描画方法を持たない.
export const isEffectType = (type) => type === 'blur' || type === 'mosaic';
// 番号(丸の中に数字). 塗りつぶしの楕円として描き, 数字を重ねる.
export const isBadge = (obj) => obj.type === 'badge';
// ペン・蛍光ペン(フリーハンドの線). 枠(x1, y1, x2, y2)と, 枠の中の位置(0〜1)の点の列で持つ.
export const isPenType = (type) => type === 'pen' || type === 'marker';
// 白地. 画像全体を1色で覆う. 作業領域では選べず, 動かせない(レイヤー一覧から選ぶ).
export const isPaper = (obj) => obj.type === 'paper';
// ペイントレイヤー. 画像全体に広がる透明なレイヤーで, 上に描いた線(消しゴムを含む)をまとめて持つ.
export const isPaint = (obj) => obj.type === 'paint';
// 画像全体に固定されたレイヤー(白地, ペイント, 元画像). 作業領域では選ばず, 動かさず, ハンドルも出さない.
// 元画像のレイヤー. 開いた画像そのもの. 1つだけあり, 消せない(隠すことはできる).
export const isBase = (obj) => Boolean(obj) && obj.type === 'base';
export const isFullLayer = (obj) => isPaper(obj) || isPaint(obj) || isBase(obj);
// くり抜きにできるもの. 白地・ペイント(画像全体に広がる)と, ぼかし・モザイク(下を加工する)は除く.
export const canCutout = (type) => !['paper', 'paint', 'blur', 'mosaic', 'base'].includes(type);
// くり抜き. 自分は描かれず, 自分の形ですぐ下のレイヤー1つに穴を開ける.
export const isCutout = (obj) => Boolean(obj && obj.cutout === true && canCutout(obj.type));

export function getDimensions(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

export const ROTATIONS = [0, 90, 180, 270];

// 回転を反映した画像の大きさ(px). 90°・270°では幅と高さが入れ替わる.
export function sourceSize(rotation = state.rotation) {
  const image = state.sourceImage;
  return rotation % 180 === 0
    ? { w: image.naturalWidth, h: image.naturalHeight }
    : { w: image.naturalHeight, h: image.naturalWidth };
}

// 回転後の画像上の位置(0〜1)を, 元画像上の位置(0〜1)へ戻す.
export function toSourcePoint(x, y, rotation = state.rotation) {
  if (rotation === 90) return { x: y, y: 1 - x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: 1 - y, y: x };
  return { x, y };
}

// 画像を90°回したときの, 位置(0〜1)の移り先. dir が1なら右(時計回り), -1なら左.
export const turnPoint = (x, y, dir) => (dir > 0 ? { x: 1 - y, y: x } : { x: y, y: 1 - x });

export function normalizeAngle(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

// プレビュー用canvasの寸法. 元画像と同じ解像度で描き, 極端に大きい場合だけ上限まで縮小する.
export function dims() {
  const { w, h } = sourceSize();
  return getDimensions(w, h, previewSide);
}

// 文字サイズ・線幅の「px」を比率へ換算するときの基準幅.
export function refWidth(rotation = state.rotation) {
  if (!state.sourceImage) return UI_REFERENCE_SIDE;
  const { w, h } = sourceSize(rotation);
  return getDimensions(w, h, UI_REFERENCE_SIDE).w;
}

// 画面上の1pxが, プレビューcanvas上で何pxにあたるか. 枠やハンドルを画面上で同じ大きさに保つために使う.
export function screenScale() {
  const displayed = original.getBoundingClientRect().width;
  return displayed > 0 ? original.width / displayed : 1;
}

export function cropPixels() {
  const { w: imageW, h: imageH } = sourceSize();
  const x = Math.max(0, Math.min(imageW - 1, Math.round(state.crop.x * imageW)));
  const y = Math.max(0, Math.min(imageH - 1, Math.round(state.crop.y * imageH)));
  const w = Math.max(1, Math.min(imageW - x, Math.round(state.crop.w * imageW)));
  const h = Math.max(1, Math.min(imageH - y, Math.round(state.crop.h * imageH)));
  return { x, y, w, h };
}

export function mapPointToCanvas(nx, ny, width, height, cropRect) {
  return {
    x: ((nx - cropRect.x) / cropRect.w) * width,
    y: ((ny - cropRect.y) / cropRect.h) * height,
  };
}

export function canvasPoint(event) {
  const rect = original.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * original.width,
    y: (event.clientY - rect.top) / rect.height * original.height,
  };
}

export function normalizedPoint(point) {
  return {
    x: Math.max(0, Math.min(1, point.x / original.width)),
    y: Math.max(0, Math.min(1, point.y / original.height)),
  };
}

// 中心位置(0〜1)の取得と移動.
export function objectCenter(obj) {
  return isText(obj) ? { x: obj.x, y: obj.y } : { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
}

export function moveObject(obj, dx, dy) {
  if (isFullLayer(obj)) return;
  if (isText(obj)) {
    obj.x += dx;
    obj.y += dy;
  } else {
    obj.x1 += dx;
    obj.x2 += dx;
    obj.y1 += dy;
    obj.y2 += dy;
  }
}

// Shift を押しながら新しく描くときの終点(0〜1)を求める.
// mode が 'square' なら, 書き始めの点を角にした画面上の正方形の対角へ. 'angle' なら, 45°刻みの向きへ.
// どちらも, 形(正方形・角度)を保ったまま画像の内側に収まるよう, 長さを縮める.
export function constrainedEnd(start, end, mode) {
  const W = original.width;
  const H = original.height;
  const sx = start.x * W;
  const sy = start.y * H;
  let dx = (end.x - start.x) * W;
  let dy = (end.y - start.y) * H;
  if (mode === 'square') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  } else {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const ux = Math.round(Math.cos(angle) * 1e9) / 1e9;
    const uy = Math.round(Math.sin(angle) * 1e9) / 1e9;
    // 指の位置を, その向きの直線へ写した長さにする.
    const length = Math.max(0, dx * ux + dy * uy);
    dx = ux * length;
    dy = uy * length;
  }
  // 画像の端を越える分だけ, 縦横を同じ割合で縮める.
  let scale = 1;
  if (dx > 0) scale = Math.min(scale, (W - sx) / dx);
  if (dx < 0) scale = Math.min(scale, -sx / dx);
  if (dy > 0) scale = Math.min(scale, (H - sy) / dy);
  if (dy < 0) scale = Math.min(scale, -sy / dy);
  scale = Math.max(0, scale);
  return { x: (sx + dx * scale) / W, y: (sy + dy * scale) / H };
}
