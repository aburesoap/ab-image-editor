// 選択枠の位置関係, 当たり判定, ハンドル. 画面の更新は行わない.

import { HANDLE_RADIUS, HANDLE_REACH, MIN_SHAPE_SIDE, ROTATE_OFFSET } from './constants.js';
import { original } from './dom.js';
import { objects, selectedObject, state } from './state.js';
import {
  isLineType, isPaper, isPenType, isText, screenScale,
} from './geometry.js';
import { hitPen } from './pen.js';
import { textLayout } from './text.js';

// オブジェクトの位置関係をcanvas上のpxで表す. 回転は中心を軸に, 描画処理と同じ向きで扱う.
export function objectFrame(obj) {
  const theta = Number(obj.rotation || 0) * Math.PI / 180;
  const base = { theta, cos: Math.cos(theta), sin: Math.sin(theta) };
  if (isText(obj)) {
    const layout = textLayout(obj, Math.max(1, obj.size * original.width));
    return {
      ...base, a: null, b: null,
      cx: obj.x * original.width,
      cy: obj.y * original.height,
      hx: layout.boxW / 2,
      hy: layout.boxH / 2,
    };
  }
  const a = { x: obj.x1 * original.width, y: obj.y1 * original.height };
  const b = { x: obj.x2 * original.width, y: obj.y2 * original.height };
  return {
    ...base,
    a,
    b,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    hx: Math.abs(b.x - a.x) / 2,
    hy: Math.abs(b.y - a.y) / 2,
  };
}

export function frameToLocal(frame, point) {
  const dx = point.x - frame.cx;
  const dy = point.y - frame.cy;
  return { x: dx * frame.cos + dy * frame.sin, y: -dx * frame.sin + dy * frame.cos };
}

export function frameToWorld(frame, local) {
  return {
    x: frame.cx + local.x * frame.cos - local.y * frame.sin,
    y: frame.cy + local.x * frame.sin + local.y * frame.cos,
  };
}

function hitTestObject(obj, point, k) {
  const frame = objectFrame(obj);
  const local = frameToLocal(frame, point);
  const tolerance = 10 * k;
  // 白地は画像全体を覆うので, 作業領域では選ばない(上に描いたものを選びやすくする. レイヤー一覧からは選べる).
  if (isPaper(obj)) return false;
  if (isPenType(obj.type)) {
    const p1 = { x: frame.a.x - frame.cx, y: frame.a.y - frame.cy };
    const p2 = { x: frame.b.x - frame.cx, y: frame.b.y - frame.cy };
    return hitPen(obj.points, p1, p2, local, tolerance + Number(obj.lineWidth || 0) * original.width / 2);
  }
  if (isLineType(obj.type)) {
    const ax = frame.a.x - frame.cx;
    const ay = frame.a.y - frame.cy;
    const vx = frame.b.x - frame.a.x;
    const vy = frame.b.y - frame.a.y;
    const lenSq = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((local.x - ax) * vx + (local.y - ay) * vy) / lenSq));
    return Math.hypot(local.x - (ax + t * vx), local.y - (ay + t * vy)) <= tolerance + Number(obj.lineWidth || 0) * original.width;
  }
  const halfW = Math.max(MIN_SHAPE_SIDE * k, frame.hx);
  const halfH = Math.max(MIN_SHAPE_SIDE * k, frame.hy);
  if (obj.type === 'ellipse' || obj.type === 'badge') {
    const rx = halfW + tolerance;
    const ry = halfH + tolerance;
    return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
  }
  return Math.abs(local.x) <= halfW + tolerance && Math.abs(local.y) <= halfH + tolerance;
}

// 前面にあるものから順に調べ, 最初に当たったものの添字を返す.
export function findObjectAtPoint(point) {
  const k = screenScale();
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    // 隠したもの・ロックしたものは, プレビュー上では選べない(レイヤー一覧からは選べる).
    if (objects[index].hidden || objects[index].locked) continue;
    if (hitTestObject(objects[index], point, k)) return index;
  }
  return -1;
}

// ハンドル一覧. 長方形・楕円・三角形は8方向のリサイズと回転, 直線・矢印は両端の移動.
// テキストは大きさが文字サイズで決まるため, 四隅(拡大縮小)と回転だけを出す.
export function objectHandles(obj) {
  // 白地は画像全体に固定なので, ハンドルを出さない.
  if (isPaper(obj)) return [];
  const frame = objectFrame(obj);
  if (isLineType(obj.type)) {
    return [
      { kind: 'end', index: 0, pos: frameToWorld(frame, { x: frame.a.x - frame.cx, y: frame.a.y - frame.cy }) },
      { kind: 'end', index: 1, pos: frameToWorld(frame, { x: frame.b.x - frame.cx, y: frame.b.y - frame.cy }) },
    ];
  }
  const k = screenScale();
  const hx = Math.max(frame.hx, MIN_SHAPE_SIDE * k);
  const hy = Math.max(frame.hy, MIN_SHAPE_SIDE * k);
  const handles = [];
  for (let sy = -1; sy <= 1; sy += 1) {
    for (let sx = -1; sx <= 1; sx += 1) {
      if (sx === 0 && sy === 0) continue;
      if (isText(obj) && (sx === 0 || sy === 0)) continue;
      handles.push({ kind: 'resize', sx, sy, pos: frameToWorld(frame, { x: sx * hx, y: sy * hy }) });
    }
  }
  handles.push({ kind: 'rotate', pos: frameToWorld(frame, { x: 0, y: -hy - ROTATE_OFFSET * k }) });
  return handles;
}

// 指定位置に最も近いハンドルを返す. 無ければ null.
export function hitHandle(point, reach = HANDLE_REACH) {
  const obj = selectedObject();
  if (!obj || obj.locked) return null;
  let best = null;
  let bestDistance = reach * screenScale();
  objectHandles(obj).forEach((handle) => {
    const distance = Math.hypot(point.x - handle.pos.x, point.y - handle.pos.y);
    if (distance <= bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  });
  return best;
}

// 切り抜き範囲のハンドル. 図形と同じく, 四隅と各辺の中央の8か所に置く(sx, sy は -1 / 0 / 1).
export function cropHandles() {
  const x = state.crop.x * original.width;
  const y = state.crop.y * original.height;
  const w = state.crop.w * original.width;
  const h = state.crop.h * original.height;
  // 範囲が画像の端にあるとハンドルが半分欠けるため, 画像の内側に収まる位置へ寄せる.
  const inset = (HANDLE_RADIUS + 1) * screenScale();
  const clampX = (value) => Math.max(inset, Math.min(original.width - inset, value));
  const clampY = (value) => Math.max(inset, Math.min(original.height - inset, value));
  const handles = [];
  for (let sy = -1; sy <= 1; sy += 1) {
    for (let sx = -1; sx <= 1; sx += 1) {
      if (sx === 0 && sy === 0) continue;
      handles.push({ kind: 'resize', sx, sy, pos: { x: clampX(x + (sx + 1) / 2 * w), y: clampY(y + (sy + 1) / 2 * h) } });
    }
  }
  return handles;
}

export function hitCropHandle(point, reach = HANDLE_REACH) {
  let best = null;
  let bestDistance = reach * screenScale();
  cropHandles().forEach((handle) => {
    const distance = Math.hypot(point.x - handle.pos.x, point.y - handle.pos.y);
    if (distance <= bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  });
  return best;
}

export function insideCrop(point) {
  const x = state.crop.x * original.width;
  const y = state.crop.y * original.height;
  return point.x >= x && point.x <= x + state.crop.w * original.width
    && point.y >= y && point.y <= y + state.crop.h * original.height;
}

// ハンドルの向き(回転を含む)を, 4種類のカーソルへ丸める.
function resizeCursor(sx, sy, cos = 1, sin = 0) {
  const dirX = sx * cos - sy * sin;
  const dirY = sx * sin + sy * cos;
  const step = ((Math.round(Math.atan2(dirY, dirX) / (Math.PI / 4)) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][step];
}

function handleCursor(handle, obj) {
  if (handle.kind === 'rotate') return 'grab';
  if (handle.kind === 'end') return 'move';
  const frame = objectFrame(obj);
  return resizeCursor(handle.sx, handle.sy, frame.cos, frame.sin);
}

export function updateHoverCursor(point) {
  let cursor = '';
  const obj = selectedObject();
  if (state.tool === 'select' && obj) {
    const handle = hitHandle(point);
    if (handle) cursor = handleCursor(handle, obj);
  } else if (state.tool === 'crop') {
    const handle = hitCropHandle(point);
    if (handle) cursor = resizeCursor(handle.sx, handle.sy);
    else if (insideCrop(point)) cursor = 'move';
  }
  if (original.style.cursor !== cursor) original.style.cursor = cursor;
}

export function startHandleAction(handle) {
  const obj = selectedObject();
  const k = screenScale();
  const frame = objectFrame(obj);
  const other = handle.kind === 'end'
    ? objectHandles(obj).find((item) => item.kind === 'end' && item.index !== handle.index)
    : null;
  state.pointerAction = {
    mode: 'handle',
    handle,
    // 操作開始時点の枠. 小さすぎる図形でも操作できるよう, 最小の大きさを確保しておく.
    frame: { ...frame, hx: Math.max(frame.hx, MIN_SHAPE_SIDE * k), hy: Math.max(frame.hy, MIN_SHAPE_SIDE * k) },
    size: isText(obj) ? obj.size : 0,
    // 操作を取り消すときに戻す, 操作開始時点のオブジェクト.
    initial: { ...obj },
    signX: !isText(obj) && obj.x2 < obj.x1 ? -1 : 1,
    signY: !isText(obj) && obj.y2 < obj.y1 ? -1 : 1,
    fixed: other ? other.pos : null,
  };
}
