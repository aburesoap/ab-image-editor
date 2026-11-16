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
  }
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
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    if (type === 'arrow') {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      // 矢じりの下限(9px)も, プレビューと同じ比率になるよう出力解像度に合わせる.
      const head = Math.max(9 * unit, lineWidth * 4);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(
        p2.x - head * Math.cos(angle - Math.PI / 6),
        p2.y - head * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        p2.x - head * Math.cos(angle + Math.PI / 6),
        p2.y - head * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fillStyle = stroke;
      ctx.fill();
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
    rect: '長方形', ellipse: '楕円', triangle: '三角形', line: '直線', arrow: '矢印', text: 'テキスト',
  })[type] || '図形';
}
