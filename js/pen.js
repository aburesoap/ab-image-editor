// ペン・蛍光ペン(フリーハンドの線)の点の扱いと描画.
// 線は, 囲む枠(x1, y1, x2, y2. 画像上の位置0〜1)と, 枠の中の位置(0〜1)の点の列 points [u, v, u, v, ...] で持つ.
// 枠で持つので, 移動・大きさの変更・回転は, ほかの図形と同じ仕組みで扱える.

import { PEN_MAX_POINTS } from './constants.js';

// 画像上の位置(0〜1)の点の列 [x, y, x, y, ...] から, 枠と枠の中の位置を求めて shape に入れる.
// 幅や高さが0の向き(横一直線など)は, 枠の中央(0.5)に置く.
export function setPenPoints(shape, absolute) {
  const xs = absolute.filter((_, i) => i % 2 === 0);
  const ys = absolute.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  shape.x1 = minX;
  shape.y1 = minY;
  shape.x2 = maxX;
  shape.y2 = maxY;
  shape.points = absolute.map((value, i) => {
    if (i % 2 === 0) return w > 0 ? (value - minX) / w : 0.5;
    return h > 0 ? (value - minY) / h : 0.5;
  });
}

// 描いている途中の線へ, 点を1つ足す. 前の点との距離(描画先のpx)が近すぎるときと, 上限を超えたときは足さない.
export function appendPenPoint(absolute, point, minGap) {
  const n = absolute.length;
  if (n >= PEN_MAX_POINTS * 2) return false;
  if (n >= 2 && Math.hypot(point.x - absolute[n - 2], point.y - absolute[n - 1]) < minGap) return false;
  absolute.push(point.x, point.y);
  return true;
}

// 枠の中の位置の点を, 中心を原点とした描画先の座標へ. p1, p2 は枠の両端(中心からの位置).
export function penLocalPoints(points, p1, p2) {
  const list = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    list.push({ x: p1.x + points[i] * (p2.x - p1.x), y: p1.y + points[i + 1] * (p2.y - p1.y) });
  }
  return list;
}

// 線を描く. ctx は, 中心を原点に, 回転を済ませた状態で渡す.
// ペンは端と角を丸く, 蛍光ペンは端を四角くし, 下の色と掛け合わせる(乗算)ことで下の文字を透かす.
// 線全体を1つのパスとして描くので, 自分自身と重なった部分も濃くならない.
export function drawPen(ctx, shape, p1, p2, lineWidth) {
  const list = penLocalPoints(shape.points || [], p1, p2);
  if (!list.length) return;
  const marker = shape.type === 'marker';
  ctx.strokeStyle = shape.stroke;
  ctx.fillStyle = shape.stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = marker ? 'square' : 'round';
  ctx.lineJoin = marker ? 'bevel' : 'round';
  if (marker) ctx.globalCompositeOperation = 'multiply';
  const moved = list.some((p) => Math.hypot(p.x - list[0].x, p.y - list[0].y) > 0.01);
  ctx.beginPath();
  if (!moved) {
    // 動かさずに押しただけのときは, 点(ペンは丸, 蛍光ペンは四角)を描く.
    const r = lineWidth / 2;
    if (marker) ctx.rect(list[0].x - r, list[0].y - r, r * 2, r * 2);
    else ctx.arc(list[0].x, list[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // 点と点の中点を通る滑らかな曲線にする(角ばった折れ線にならないよう).
  ctx.moveTo(list[0].x, list[0].y);
  if (list.length === 2) {
    ctx.lineTo(list[1].x, list[1].y);
  } else {
    for (let i = 1; i < list.length - 1; i += 1) {
      const mid = { x: (list[i].x + list[i + 1].x) / 2, y: (list[i].y + list[i + 1].y) / 2 };
      ctx.quadraticCurveTo(list[i].x, list[i].y, mid.x, mid.y);
    }
    const last = list[list.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

// 点(枠の中心を原点とした座標)が, 線から tolerance 以内にあるか.
export function hitPen(points, p1, p2, local, tolerance) {
  const list = penLocalPoints(points || [], p1, p2);
  if (list.length === 1) return Math.hypot(local.x - list[0].x, local.y - list[0].y) <= tolerance;
  for (let i = 0; i + 1 < list.length; i += 1) {
    const a = list[i];
    const b = list[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((local.x - a.x) * vx + (local.y - a.y) * vy) / lenSq));
    if (Math.hypot(local.x - (a.x + t * vx), local.y - (a.y + t * vy)) <= tolerance) return true;
  }
  return false;
}
