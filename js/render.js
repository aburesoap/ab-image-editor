// プレビューの描画. 元画像・オブジェクト・選択枠・切り抜き枠を重ねる.

import { FULL_CROP, HANDLE_RADIUS, MIN_SHAPE_SIDE, ROTATE_OFFSET } from './constants.js';
import { octx, original } from './dom.js';
import { objects, selectedObject, state } from './state.js';
import {
  dims, isCutout, isLineType, isText, screenScale, sourceSize, toSourcePoint,
} from './geometry.js';
import { drawWithCutouts } from './cutout.js';
import { drawText } from './text.js';
import { drawShape } from './shapes.js';
import { cropHandles, objectFrame, objectHandles } from './handles.js';
import { fitCanvases } from './stage.js';
import { isMulti, selectedObjects } from './selection.js';
import { selectionBounds, strokeSelectMode } from './paint-select.js';

function drawObject(ctx, width, height, obj, cropRect) {
  if (isText(obj)) drawText(ctx, width, height, obj, cropRect);
  else drawShape(ctx, width, height, obj, cropRect);
}

// 元画像のうち切り抜き範囲を, 向き(回転)を反映して描く.
function drawSource(ctx, width, height, cropRect) {
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

// 切り抜き範囲を基準に, 元画像・オブジェクト(背面から順)の順で指定のcontextへ重ねて描く.
export function renderComposite(ctx, width, height, cropRect) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawSource(ctx, width, height, cropRect);
  // 置いている途中の図形は, いちばん上に置かれるものとして一緒に描く(くり抜きなら, その場で穴が見える).
  const list = state.currentShape ? [...objects, state.currentShape] : objects;
  list.forEach((obj, index) => {
    // くり抜きは自分では描かず, 下のレイヤーと一緒に描く.
    if (isCutout(obj)) return;
    // すぐ上に続いているくり抜き(隠したものを除く)を集める.
    const cutouts = [];
    for (let j = index + 1; j < list.length && isCutout(list[j]); j += 1) {
      if (!list[j].hidden) cutouts.push(list[j]);
    }
    // 隠したオブジェクトは, プレビューにも書き出しにも描かない.
    if (obj.hidden) return;
    if (cutouts.length) drawWithCutouts(ctx, width, height, obj, cutouts, cropRect, drawObject);
    else drawObject(ctx, width, height, obj, cropRect);
  });
}

export function buildCompositeCanvas(width, height, cropRect) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  renderComposite(canvas.getContext('2d'), width, height, cropRect);
  return canvas;
}

export function drawEditor() {
  if (!state.sourceImage) return;
  const { w, h } = dims();
  // canvasの幅や高さを代入すると内容が消えて再確保されるため, 寸法が変わるときだけ代入する.
  if (original.width !== w || original.height !== h) {
    original.width = w;
    original.height = h;
    fitCanvases();
  } else {
    octx.clearRect(0, 0, w, h);
  }

  renderComposite(octx, w, h, FULL_CROP);
  if (state.tool === 'crop') drawCropOverlay(w, h, screenScale());
  const selected = selectedObject();
  if (selected && state.tool === 'select') drawSelection(selected);
  // 複数を選んでいるときは, それぞれの枠だけを描く(ハンドルは出さない).
  if (isMulti() && state.tool === 'select') selectedObjects().forEach((obj) => drawFrameOnly(obj));
  // 整列のガイド. そろった位置に, 画像の端から端まで線を引く.
  if (state.guideLines && state.pointerAction) drawGuideLines(state.guideLines, w, h);
  // ペイントレイヤーの線を選んでいるときは, 選んだ線をまとめて囲む枠を描く.
  const paint = strokeSelectMode();
  const bounds = paint ? selectionBounds(paint) : null;
  if (bounds) {
    octx.save();
    octx.beginPath();
    octx.rect(bounds.left * w, bounds.top * h, (bounds.right - bounds.left) * w, (bounds.bottom - bounds.top) * h);
    strokeFrame(screenScale());
    octx.restore();
  }
  // 範囲選択の途中は, 囲んでいる範囲を描く. 線の範囲選択は 0〜1 で持っているので, 画素に直す.
  const action = state.pointerAction;
  if (action && action.mode === 'strokes-marquee' && action.moved) {
    octx.save();
    octx.beginPath();
    octx.rect(action.x1 * w, action.y1 * h, (action.x2 - action.x1) * w, (action.y2 - action.y1) * h);
    octx.fillStyle = 'rgba(45,87,158,.12)';
    octx.fill();
    strokeFrame(screenScale());
    octx.restore();
  }
  if (action && action.mode === 'marquee' && action.moved) {
    octx.save();
    octx.beginPath();
    octx.rect(action.x1, action.y1, action.x2 - action.x1, action.y2 - action.y1);
    octx.fillStyle = 'rgba(45,87,158,.12)';
    octx.fill();
    strokeFrame(screenScale());
    octx.restore();
  }
}

function drawGuideLines(lines, w, h) {
  const k = screenScale();
  octx.save();
  octx.lineWidth = 1 * k;
  octx.strokeStyle = '#e0368c';
  octx.beginPath();
  lines.x.forEach((x) => {
    octx.moveTo(x, 0);
    octx.lineTo(x, h);
  });
  lines.y.forEach((y) => {
    octx.moveTo(0, y);
    octx.lineTo(w, y);
  });
  octx.stroke();
  octx.restore();
}

// 枠だけを描く(複数を選んでいるとき). 直線・矢印も, 両端を囲む枠にする.
function drawFrameOnly(obj) {
  const k = screenScale();
  const frame = objectFrame(obj);
  const hx = Math.max(frame.hx, MIN_SHAPE_SIDE * k);
  const hy = Math.max(frame.hy, MIN_SHAPE_SIDE * k);
  octx.save();
  octx.translate(frame.cx, frame.cy);
  octx.rotate(frame.theta);
  octx.beginPath();
  octx.rect(-hx, -hy, hx * 2, hy * 2);
  strokeFrame(k);
  octx.restore();
}

// 選択枠とハンドルの見た目. 図形の選択と切り抜き範囲で共通にする.
const ACCENT = '#2d579e';

// 白い下地の上に破線を重ね, どんな色の画像の上でも見えるようにする. 枠の形は呼び出し側で現在のパスに作っておく.
function strokeFrame(k) {
  octx.lineWidth = 3 * k;
  octx.strokeStyle = '#ffffff';
  octx.setLineDash([]);
  octx.stroke();
  octx.lineWidth = 1.5 * k;
  octx.strokeStyle = ACCENT;
  octx.setLineDash([5 * k, 3 * k]);
  octx.stroke();
  octx.setLineDash([]);
}

// ハンドル1つ. 大きさを変えるものは白い四角, 回転などそれ以外は丸, 動かせないものは塗りつぶし.
function drawHandle(handle, k, locked = false) {
  const radius = HANDLE_RADIUS * k;
  octx.save();
  octx.lineWidth = 1.5 * k;
  octx.strokeStyle = ACCENT;
  octx.fillStyle = locked ? ACCENT : handle.kind === 'resize' ? '#ffffff' : '#dce7f5';
  octx.beginPath();
  if (handle.kind === 'resize') {
    octx.rect(handle.pos.x - radius, handle.pos.y - radius, radius * 2, radius * 2);
  } else {
    octx.arc(handle.pos.x, handle.pos.y, radius, 0, Math.PI * 2);
  }
  octx.fill();
  octx.stroke();
  octx.restore();
}

// 切り抜き範囲の外側を暗くし, 図形の選択と同じ枠とハンドルを重ねる. k は画面上の大きさを保つための換算値.
function drawCropOverlay(w, h, k) {
  const x = state.crop.x * w;
  const y = state.crop.y * h;
  const cw = state.crop.w * w;
  const ch = state.crop.h * h;
  octx.save();
  octx.fillStyle = 'rgba(4,8,18,.62)';
  const shade = (sx, sy, sw, sh) => {
    if (sw > 0 && sh > 0) octx.fillRect(sx, sy, sw, sh);
  };
  shade(0, 0, w, y);
  shade(0, y + ch, w, h - y - ch);
  shade(0, y, x, ch);
  shade(x + cw, y, w - x - cw, ch);
  octx.beginPath();
  octx.rect(x, y, cw, ch);
  strokeFrame(k);
  octx.restore();
  cropHandles().forEach((handle) => drawHandle(handle, k));
}

// ドラッグ中など高頻度の再描画は, 1フレームに1回へまとめる.
export function requestDraw() {
  if (state.drawFrame) return;
  state.drawFrame = window.requestAnimationFrame(() => {
    state.drawFrame = 0;
    drawEditor();
  });
}

// 選択中のオブジェクトに, 枠とハンドルを重ねる. 枠は一緒に回転し, ハンドルは画面上で同じ大きさに保つ.
// ロック中は動かせないため, ハンドルを出さない(直線・矢印は両端に印だけを描く).
function drawSelection(obj) {
  const k = screenScale();
  const frame = objectFrame(obj);

  if (!isLineType(obj.type)) {
    const hx = Math.max(frame.hx, MIN_SHAPE_SIDE * k);
    const hy = Math.max(frame.hy, MIN_SHAPE_SIDE * k);
    octx.save();
    octx.translate(frame.cx, frame.cy);
    octx.rotate(frame.theta);
    octx.beginPath();
    octx.rect(-hx, -hy, hx * 2, hy * 2);
    if (!obj.locked && obj.type !== 'paper' && obj.type !== 'paint') {
      octx.moveTo(0, -hy);
      octx.lineTo(0, -hy - ROTATE_OFFSET * k);
    }
    strokeFrame(k);
    octx.restore();
  }

  if (obj.locked && !isLineType(obj.type)) return;
  objectHandles(obj).forEach((handle) => drawHandle(handle, k, Boolean(obj.locked)));
}
