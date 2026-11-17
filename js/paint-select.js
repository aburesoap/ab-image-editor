// ペイントレイヤーの中の線を選んで動かす. ペンの道具の種類「線を選んで動かす」で使う.
// 選んだ線は, レイヤーの id と線の番号(strokes の添字)で持つ. 線を描き足したり消したりすると, 選択は外す.

import { original } from './dom.js';
import { objects, state } from './state.js';

// 選んでいる線. layerId は描き先のペイントレイヤーの id.
export const strokeSelection = { layerId: null, indices: [] };

export function clearStrokeSelection() {
  strokeSelection.layerId = null;
  strokeSelection.indices = [];
}

// 指定のレイヤーで選んでいる線の番号(今もある線だけ).
export function selectedStrokeIndices(layer) {
  if (!layer || strokeSelection.layerId !== layer.id) return [];
  const count = (layer.strokes || []).length;
  return strokeSelection.indices.filter((i) => i < count);
}

export function setStrokeSelection(layer, indices) {
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  strokeSelection.layerId = unique.length ? layer.id : null;
  strokeSelection.indices = unique;
}

// 線を囲む長方形(0〜1). 太さの半分だけ広げる(幅の比率は, 縦方向へは画像の縦横比で換算する).
export function strokeBounds(stroke) {
  const p = stroke.points || [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    left = Math.min(left, p[i]);
    right = Math.max(right, p[i]);
    top = Math.min(top, p[i + 1]);
    bottom = Math.max(bottom, p[i + 1]);
  }
  const halfX = Number(stroke.width || 0) / 2;
  const halfY = halfX * original.width / Math.max(1, original.height);
  return { left: left - halfX, top: top - halfY, right: right + halfX, bottom: bottom + halfY };
}

// 選んだ線の全体を囲む長方形(0〜1). 選んでいなければ null.
export function selectionBounds(layer) {
  const indices = selectedStrokeIndices(layer);
  if (!indices.length) return null;
  return indices.map((i) => strokeBounds(layer.strokes[i])).reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }));
}

// 範囲(0〜1)に触れている線の番号. 消しゴムの線も含める(消した跡も一緒に動くように).
export function strokesInRect(layer, rect) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return (layer.strokes || []).map((stroke, i) => [stroke, i]).filter(([stroke]) => {
    const b = strokeBounds(stroke);
    return b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom;
  }).map(([, i]) => i);
}

// 選んだ線を (dx, dy)(0〜1)だけ動かした線の列を作る. 元の列(initial)は書き換えない(履歴に残っているため).
// 点の位置は 0〜1 の範囲で保存するので, 選んだ線の点がすべて画像の内側に残るよう, 動かす量を抑える.
export function movedStrokes(initial, indices, dx, dy) {
  const chosen = new Set(indices);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  indices.forEach((i) => {
    const p = initial[i].points;
    for (let j = 0; j + 1 < p.length; j += 2) {
      minX = Math.min(minX, p[j]);
      maxX = Math.max(maxX, p[j]);
      minY = Math.min(minY, p[j + 1]);
      maxY = Math.max(maxY, p[j + 1]);
    }
  });
  const mx = Math.max(-minX, Math.min(1 - maxX, dx));
  const my = Math.max(-minY, Math.min(1 - maxY, dy));
  return initial.map((stroke, i) => {
    if (!chosen.has(i)) return stroke;
    return { ...stroke, points: stroke.points.map((v, j) => v + (j % 2 === 0 ? mx : my)) };
  });
}

// 選んだ線を消した線の列.
export function strokesWithout(layer, indices) {
  const chosen = new Set(indices);
  return (layer.strokes || []).filter((_, i) => !chosen.has(i));
}

// 線を選ぶ道具を使っているか(ペンの道具で, 種類が「線を選んで動かす」, 描き先がペイントレイヤー).
export function strokeSelectMode() {
  const obj = state.selectedIndex >= 0 ? objects[state.selectedIndex] : null;
  return state.tool === 'pen' && state.penType === 'move' && Boolean(obj) && obj.type === 'paint' ? obj : null;
}
