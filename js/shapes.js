// 図形の描画と, 図形・テキストの新規作成.

import { TEXT_DEFAULTS } from './constants.js';
import { $ } from './dom.js';
import { newObjectId, state } from './state.js';
import { isLineType, mapPointToCanvas, refWidth } from './geometry.js';

// 線・矢印では「窓」を選べないため, 選択肢を無効化して値も補正する.
export function syncWindowStyleOption(styleSelect, type) {
  const lineType = isLineType(type);
  styleSelect.querySelector('option[value="window"]').disabled = lineType;
  if (lineType && styleSelect.value === 'window') styleSelect.value = 'stroke';
}

// 新しく置く図形の設定. 描画方法はオプションバー, 色や太さは直前に編集した値を使う.
export function newShapeStyle() {
  const type = state.shapeType;
  let style = $('shapeStyle').value;
  if (isLineType(type) && style === 'window') style = 'stroke';
  const last = state.lastShape;
  return {
    type,
    style,
    fill: last.fill,
    stroke: last.stroke,
    // 線幅も画像幅に対する比率で保存し, 出力解像度に追従させる.
    lineWidth: last.lineWidthPx / refWidth(),
    opacity: last.opacity,
    rotation: 0,
    hidden: false,
    locked: false,
  };
}

// 0〜1の座標で表した多角形を, 枠(left, top, width, height)へ当てはめてパスに加える.
function polygonPath(ctx, points, left, top, width, height) {
  points.forEach(([px, py], i) => {
    const x = left + px * width;
    const y = top + py * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// 五芒星の頂点. 外側の頂点が枠の上端・左右端・下端にちょうど届くよう, 0〜1へ正規化しておく.
const STAR_POINTS = (() => {
  const inner = 0.382;
  const raw = Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : inner;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  });
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  return raw.map(([x, y]) => [(x - minX) / spanX, (y - minY) / spanY]);
})();

// 右向きの太矢印. 軸は高さの40%, 矢じりは幅の40%.
const BLOCK_ARROW_POINTS = [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]];

// 吹き出し. 上の78%が角丸の本体で, 左下へしっぽが伸びる. 枠線でも1本の輪郭になるよう, しっぽごと一筆で描く.
function balloonPath(ctx, left, top, width, height) {
  const bottom = top + height * 0.78;
  const right = left + width;
  const r = Math.min(width, bottom - top) * 0.18;
  ctx.moveTo(left + r, top);
  ctx.arcTo(right, top, right, bottom, r);
  ctx.arcTo(right, bottom, left, bottom, r);
  ctx.lineTo(left + width * 0.42, bottom);
  ctx.lineTo(left + width * 0.15, top + height);
  ctx.lineTo(left + width * 0.25, bottom);
  ctx.arcTo(left, bottom, left, top, r);
  ctx.arcTo(left, top, right, top, r);
  ctx.closePath();
}

// 図形の輪郭を現在のパスへ追加する. beginPath() は呼び出し側で行う.
function shapePath(ctx, type, x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.max(1, Math.abs(x2 - x1));
  const height = Math.max(1, Math.abs(y2 - y1));

  if (type === 'rect') {
    ctx.rect(left, top, width, height);
  } else if (type === 'ellipse') {
    // 他のサブパスと線で結ばれないよう, 楕円の開始点へ先に移動する.
    ctx.moveTo(left + width, top + height / 2);
    ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (type === 'triangle') {
    ctx.moveTo(left + width / 2, top);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left, top + height);
    ctx.closePath();
  } else if (type === 'roundrect') {
    ctx.roundRect(left, top, width, height, Math.min(width, height) * 0.18);
  } else if (type === 'diamond') {
    polygonPath(ctx, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], left, top, width, height);
  } else if (type === 'star') {
    polygonPath(ctx, STAR_POINTS, left, top, width, height);
  } else if (type === 'blockarrow') {
    polygonPath(ctx, BLOCK_ARROW_POINTS, left, top, width, height);
  } else if (type === 'balloon') {
    balloonPath(ctx, left, top, width, height);
  }
}

// 多角形を, 現在のパスへ時計回り(画面の向き)にそろえて加える.
// 向きをそろえると, 重なった部分も nonzero の塗りで1回だけ塗られ, 半透明でも濃くならない.
function clockwisePolygon(ctx, points) {
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  const list = area < 0 ? [...points].reverse() : points;
  list.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

// 矢印・両矢印を, 矢じりと軸をまとめた1つの輪郭として塗る.
// 線を先端まで引くと, 線の太さと丸い端が矢じりの先から突き出すため, 軸は矢じりの中で止める.
function drawArrow(ctx, p1, p2, lineWidth, head, both) {
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const ux = (p2.x - p1.x) / length;
  const uy = (p2.y - p1.y) / length;
  const half = lineWidth / 2;
  // 矢じりの付け根(先端から head × cos30°)より少し先端寄りで, 軸を止める.
  const inset = head * Math.cos(Math.PI / 6) * 0.8;
  const headAt = (tip, dir) => {
    const back = { x: tip.x - dir * ux * head * Math.cos(Math.PI / 6), y: tip.y - dir * uy * head * Math.cos(Math.PI / 6) };
    const side = head * Math.sin(Math.PI / 6);
    return [
      tip,
      { x: back.x - uy * side, y: back.y + ux * side },
      { x: back.x + uy * side, y: back.y - ux * side },
    ];
  };
  ctx.beginPath();
  clockwisePolygon(ctx, headAt(p2, 1));
  if (both) clockwisePolygon(ctx, headAt(p1, -1));
  const start = both ? { x: p1.x + ux * inset, y: p1.y + uy * inset } : p1;
  const end = { x: p2.x - ux * inset, y: p2.y - uy * inset };
  // 矢じりだけで長さが埋まるときは, 軸を描かない.
  if ((end.x - start.x) * ux + (end.y - start.y) * uy > 0) {
    clockwisePolygon(ctx, [
      { x: start.x - uy * half, y: start.y + ux * half },
      { x: end.x - uy * half, y: end.y + ux * half },
      { x: end.x + uy * half, y: end.y - ux * half },
      { x: start.x + uy * half, y: start.y - ux * half },
    ]);
    if (!both) {
      // 矢じりの無い端は, 直線と同じく丸める.
      ctx.moveTo(p1.x + half, p1.y);
      ctx.arc(p1.x, p1.y, half, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

export function drawShape(ctx, width, height, shape, cropRect) {
  const mapped1 = mapPointToCanvas(shape.x1, shape.y1, width, height, cropRect);
  const mapped2 = mapPointToCanvas(shape.x2, shape.y2, width, height, cropRect);
  const centerX = (mapped1.x + mapped2.x) / 2;
  const centerY = (mapped1.y + mapped2.y) / 2;
  const p1 = { x: mapped1.x - centerX, y: mapped1.y - centerY };
  const p2 = { x: mapped2.x - centerX, y: mapped2.y - centerY };
  const { type, style, fill, stroke, opacity } = shape;
  // 基準サイズ(UI上のpx)の1pxが, 描画先で何pxになるか.
  const unit = width / cropRect.w / refWidth();
  const lineWidth = Math.max(1, Number(shape.lineWidth || 0) * width / cropRect.w);
  const rotation = Number(shape.rotation || 0) * Math.PI / 180;

  if (style === 'window' && !isLineType(type)) {
    // 全面の矩形と図形を偶奇規則で塗り, 図形の内側だけを抜く. 一時canvasを作らないので高解像度でも軽い.
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    shapePath(ctx, type, p1.x, p1.y, p2.x, p2.y);
    ctx.fill('evenodd');
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);

  if (isLineType(type)) {
    if (type === 'line') {
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else {
      ctx.fillStyle = stroke;
      // 矢じりの下限(9px)も, プレビューと同じ比率になるよう出力解像度に合わせる.
      drawArrow(ctx, p1, p2, lineWidth, Math.max(9 * unit, lineWidth * 4), type === 'arrow2');
    }
    ctx.restore();
    return;
  }

  ctx.beginPath();
  shapePath(ctx, type, p1.x, p1.y, p2.x, p2.y);
  if (style === 'fill') {
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
}

export function makeShape(start, end, style) {
  return {
    ...style,
    id: newObjectId(),
    rotation: Number(style.rotation || 0),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
}

// 新しく置くテキスト. 内容以外は, 直前に編集した値を引き継ぐ.
export function makeText(point) {
  const last = state.lastText;
  return {
    id: newObjectId(),
    type: 'text',
    content: TEXT_DEFAULTS.content,
    color: last.color,
    bg: last.bg,
    transparent: last.transparent,
    size: last.sizePx / refWidth(),
    font: last.font,
    weight: last.weight,
    opacity: last.opacity,
    rotation: 0,
    hidden: false,
    locked: false,
    x: point.x,
    y: point.y,
  };
}

export function objectTypeLabel(type) {
  return ({
    rect: '長方形',
    roundrect: '角丸長方形',
    ellipse: '楕円',
    triangle: '三角形',
    diamond: 'ひし形',
    star: '星',
    balloon: '吹き出し',
    blockarrow: '太矢印',
    line: '直線',
    arrow: '矢印',
    arrow2: '両矢印',
    text: 'テキスト',
  })[type] || '図形';
}
