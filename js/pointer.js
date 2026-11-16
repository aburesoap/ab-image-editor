// プレビュー上のポインタ操作(配置, 選択, 移動, ハンドル, 切り抜き).

import {
  BADGE_DEFAULTS,
  HANDLE_REACH,
  HANDLE_REACH_TOUCH,
  MAX_OBJECTS,
  MIN_CROP,
  MIN_SHAPE_SIDE,
  PAINT_MAX_STROKES,
  TEXT_MAX_PX,
  TEXT_MIN_PX,
} from './constants.js';
import { $, original, setStatus } from './dom.js';
import { objects, selectedObject, state } from './state.js';
import {
  canvasPoint, isText, moveObject, normalizeAngle, normalizedPoint, refWidth, screenScale,
} from './geometry.js';
import { loadFontsFor } from './text.js';
import { makeShape, makeText, newShapeStyle } from './shapes.js';
import { appendPenPoint, setPenPoints } from './pen.js';
import { activePaint } from './pen-options.js';
import {
  findObjectAtPoint,
  frameToLocal,
  frameToWorld,
  hitCropHandle,
  hitHandle,
  insideCrop,
  startHandleAction,
  updateHoverCursor,
} from './handles.js';
import { drawEditor, requestDraw } from './render.js';
import { invalidateResult } from './convert.js';
import { updateSelectionInspector } from './inspector.js';
import { commitChange, pushHistory } from './history.js';
import { afterPlacement, showTab } from './actions.js';

// ハンドルのドラッグに合わせてオブジェクトを更新する. snap がtrueのときは, 回転を15°刻みにする.
function dragHandle(rawPoint, snap) {
  const action = state.pointerAction;
  const obj = selectedObject();
  if (!action || !obj) return;
  const W = original.width;
  const H = original.height;
  const frame = action.frame;
  // 画像の外へ大きく出ないよう, ドラッグ位置を画像の周囲(半分の幅)までに制限する.
  const point = {
    x: Math.max(-W / 2, Math.min(W * 1.5, rawPoint.x)),
    y: Math.max(-H / 2, Math.min(H * 1.5, rawPoint.y)),
  };

  if (action.handle.kind === 'rotate') {
    let angle = Math.atan2(rawPoint.y - frame.cy, rawPoint.x - frame.cx) * 180 / Math.PI + 90;
    if (snap) angle = Math.round(angle / 15) * 15;
    obj.rotation = normalizeAngle(angle);
  } else if (action.handle.kind === 'end') {
    // 動かす端は指の位置へ, もう一方は固定. 回転角は保ったまま, 中心と両端の座標を求め直す.
    const moving = point;
    const fixed = action.fixed;
    const center = { x: (moving.x + fixed.x) / 2, y: (moving.y + fixed.y) / 2 };
    const toLocal = (p) => ({
      x: (p.x - center.x) * frame.cos + (p.y - center.y) * frame.sin,
      y: -(p.x - center.x) * frame.sin + (p.y - center.y) * frame.cos,
    });
    const lm = toLocal(moving);
    const lf = toLocal(fixed);
    const first = action.handle.index === 0 ? lm : lf;
    const second = action.handle.index === 0 ? lf : lm;
    obj.x1 = (center.x + first.x) / W;
    obj.y1 = (center.y + first.y) / H;
    obj.x2 = (center.x + second.x) / W;
    obj.y2 = (center.y + second.y) / H;
  } else if (isText(obj)) {
    // 対角の隅を固定したまま, 文字サイズを拡大縮小する. ボックスの大きさは文字サイズに比例する.
    const { sx, sy } = action.handle;
    const local = frameToLocal(frame, point);
    const anchor = { x: -sx * frame.hx, y: -sy * frame.hy };
    const diag = { x: 2 * sx * frame.hx, y: 2 * sy * frame.hy };
    const ratio = ((local.x - anchor.x) * diag.x + (local.y - anchor.y) * diag.y) / (diag.x * diag.x + diag.y * diag.y);
    const ref = refWidth();
    const size = Math.max(TEXT_MIN_PX / ref, Math.min(TEXT_MAX_PX / ref, action.size * ratio));
    const scale = size / action.size;
    const center = frameToWorld(frame, { x: anchor.x * (1 - scale), y: anchor.y * (1 - scale) });
    obj.size = size;
    obj.x = center.x / W;
    obj.y = center.y / H;
  } else {
    // 反対側の辺(または角)を固定し, 図形の向きに沿った座標系で大きさと中心を求める.
    const local = frameToLocal(frame, point);
    const minSide = MIN_SHAPE_SIDE * screenScale();
    const span = (dir, half, value) => {
      if (dir === 0) return [-half, half];
      const anchor = -dir * half;
      const moved = anchor + dir * Math.max(minSide, (value - anchor) * dir);
      return [Math.min(anchor, moved), Math.max(anchor, moved)];
    };
    const [x0, x1] = span(action.handle.sx, frame.hx, local.x);
    const [y0, y1] = span(action.handle.sy, frame.hy, local.y);
    const center = frameToWorld(frame, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    const width = x1 - x0;
    const height = y1 - y0;
    obj.x1 = (center.x - action.signX * width / 2) / W;
    obj.x2 = (center.x + action.signX * width / 2) / W;
    obj.y1 = (center.y - action.signY * height / 2) / H;
    obj.y2 = (center.y + action.signY * height / 2) / H;
  }
  updateSelectionInspector();
  requestDraw();
}

original.addEventListener('pointerdown', (event) => {
  if (!state.sourceImage || state.view !== 'edit') return;
  const point = canvasPoint(event);

  // 選択中のオブジェクトのハンドルを掴んだ場合は, 選択や移動よりもハンドル操作を優先する.
  if (state.tool === 'select' && state.selectedIndex >= 0) {
    const handle = hitHandle(point, event.pointerType === 'touch' ? HANDLE_REACH_TOUCH : HANDLE_REACH);
    if (handle) {
      startHandleAction(handle);
      original.setPointerCapture(event.pointerId);
      return;
    }
  }

  if (state.tool === 'text') {
    // 文字は指を離した時点で配置する. 直後の疑似マウスイベントで入力欄の焦点が外れないよう, 既定の動作を止める.
    event.preventDefault();
    state.pointerAction = { mode: 'text-new', point: normalizedPoint(point) };
  } else if (state.tool === 'pen' && activePaint()) {
    // ペイントレイヤーを選んでいる間は, そのレイヤーの中に描く.
    const paint = activePaint();
    if (paint.locked || paint.hidden) {
      setStatus('ロック中・非表示のペイントレイヤーには描けません. レイヤー一覧で解除してください');
      return;
    }
    if ((paint.strokes || []).length >= PAINT_MAX_STROKES) {
      setStatus('このペイントレイヤーには, これ以上描けません. 新しいペイントレイヤーを足してください');
      return;
    }
    const start = normalizedPoint(point);
    const look = state.lastPen[state.penType];
    state.currentStroke = {
      targetId: paint.id,
      tool: state.penType,
      color: look.stroke,
      width: look.widthPx / refWidth(),
      opacity: look.opacity,
      points: [start.x, start.y],
    };
    state.pointerAction = { mode: 'paint', start };
  } else if (state.tool === 'pen' && state.penType === 'eraser') {
    setStatus('消しゴムは, ペイントレイヤーの中で使えます. レイヤー一覧の「＋ ペイント」で足してください');
    return;
  } else if (state.tool === 'pen') {
    const start = normalizedPoint(point);
    const look = state.lastPen[state.penType];
    state.currentShape = makeShape(start, start, {
      type: state.penType,
      style: 'stroke',
      stroke: look.stroke,
      // 太さも画像幅に対する比率で保存し, 出力解像度に追従させる.
      lineWidth: look.widthPx / refWidth(),
      opacity: look.opacity,
      rotation: 0,
      hidden: false,
      locked: false,
    });
    const absolute = [start.x, start.y];
    setPenPoints(state.currentShape, absolute);
    state.pointerAction = { mode: 'pen', start, absolute };
  } else if (state.tool === 'shape') {
    const start = normalizedPoint(point);
    state.currentShape = makeShape(start, start, newShapeStyle());
    state.pointerAction = { mode: 'shape', start };
  } else if (state.tool === 'select') {
    const index = findObjectAtPoint(point);
    state.selectedIndex = index;
    if (index >= 0) {
      state.pointerAction = {
        mode: 'object-move',
        start: normalizedPoint(point),
        initial: { ...objects[index] },
      };
    } else {
      state.pointerAction = null;
    }
    updateSelectionInspector();
    if (index >= 0) showTab('props');
    drawEditor();
  } else {
    // 切り抜き範囲は, 図形と同じ8か所のハンドルで大きさを変え, 内側のドラッグで動かす.
    const handle = hitCropHandle(point, event.pointerType === 'touch' ? HANDLE_REACH_TOUCH : HANDLE_REACH);
    if (handle) {
      state.pointerAction = { mode: 'crop-resize', handle, startX: point.x, startY: point.y, initial: { ...state.crop } };
    } else if (insideCrop(point)) {
      state.pointerAction = { mode: 'crop-move', startX: point.x, startY: point.y, initial: { ...state.crop } };
    } else {
      const p = normalizedPoint(point);
      state.pointerAction = { mode: 'crop-new', start: p, initial: { ...state.crop }, moved: false };
    }
  }
  if (state.pointerAction) original.setPointerCapture(event.pointerId);
});

original.addEventListener('pointermove', (event) => {
  const point = canvasPoint(event);
  if (!state.pointerAction) {
    updateHoverCursor(point);
    return;
  }

  if (state.pointerAction.mode === 'handle') {
    dragHandle(point, event.shiftKey);
    return;
  }
  if (state.pointerAction.mode === 'text-new') return;
  if (state.pointerAction.mode === 'paint') {
    const action = state.pointerAction;
    const now = normalizedPoint(point);
    const stroke = state.currentStroke;
    if (event.shiftKey) {
      stroke.points = [action.start.x, action.start.y, now.x, now.y];
    } else if (!appendPenPoint(stroke.points, now, 1.5 * screenScale() / original.width)) {
      return;
    }
    requestDraw();
    return;
  }
  if (state.pointerAction.mode === 'pen') {
    const action = state.pointerAction;
    const now = normalizedPoint(point);
    if (event.shiftKey) {
      // Shift を押している間は, 書き始めの点から今の点までの直線にする.
      action.absolute = [action.start.x, action.start.y, now.x, now.y];
    } else {
      // 画面上で1.5pxより近い点は足さない(点の数を抑える).
      const before = action.absolute.length;
      appendPenPoint(action.absolute, now, 1.5 * screenScale() / original.width);
      if (action.absolute.length === before) return;
    }
    setPenPoints(state.currentShape, action.absolute);
    requestDraw();
    return;
  }
  if (state.pointerAction.mode === 'shape') {
    const end = normalizedPoint(point);
    state.currentShape.x2 = end.x;
    state.currentShape.y2 = end.y;
    requestDraw();
    return;
  }
  if (state.pointerAction.mode === 'object-move') {
    const now = normalizedPoint(point);
    const obj = selectedObject();
    if (obj) {
      Object.assign(obj, state.pointerAction.initial);
      moveObject(obj, now.x - state.pointerAction.start.x, now.y - state.pointerAction.start.y);
      updateSelectionInspector();
      requestDraw();
    }
    return;
  }

  if (state.pointerAction.mode === 'crop-new') {
    // 枠の外をクリックしただけでは, 切り抜き範囲を変更しない.
    state.pointerAction.moved = true;
    const start = state.pointerAction.start;
    const end = normalizedPoint(point);
    const w = Math.max(MIN_CROP, Math.abs(end.x - start.x));
    const h = Math.max(MIN_CROP, Math.abs(end.y - start.y));
    state.crop = {
      x: Math.min(Math.min(start.x, end.x), 1 - w),
      y: Math.min(Math.min(start.y, end.y), 1 - h),
      w,
      h,
    };
  } else {
    const dx = (point.x - state.pointerAction.startX) / original.width;
    const dy = (point.y - state.pointerAction.startY) / original.height;
    const initial = state.pointerAction.initial;
    if (state.pointerAction.mode === 'crop-move') {
      state.crop.x = Math.max(0, Math.min(1 - initial.w, initial.x + dx));
      state.crop.y = Math.max(0, Math.min(1 - initial.h, initial.y + dy));
    } else if (state.pointerAction.mode === 'crop-resize') {
      // 掴んだ辺(または角)だけを動かし, 反対側の辺は固定する.
      const { sx, sy } = state.pointerAction.handle;
      let x0 = initial.x;
      let x1 = initial.x + initial.w;
      let y0 = initial.y;
      let y1 = initial.y + initial.h;
      if (sx > 0) x1 = Math.max(x0 + MIN_CROP, Math.min(1, x1 + dx));
      if (sx < 0) x0 = Math.min(x1 - MIN_CROP, Math.max(0, x0 + dx));
      if (sy > 0) y1 = Math.max(y0 + MIN_CROP, Math.min(1, y1 + dy));
      if (sy < 0) y0 = Math.min(y1 - MIN_CROP, Math.max(0, y0 + dy));
      state.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  requestDraw();
});

// 番号を, 置いた点を中心にした, 画面上で正円の大きさにする(大きさは BADGE_DEFAULTS.sizePx).
function sizeBadgeAround(shape) {
  const ref = refWidth();
  const halfX = BADGE_DEFAULTS.sizePx / ref / 2;
  const halfY = halfX * original.width / original.height;
  const cx = shape.x1;
  const cy = shape.y1;
  Object.assign(shape, { x1: cx - halfX, x2: cx + halfX, y1: cy - halfY, y2: cy + halfY });
}

function finishPointerAction() {
  const action = state.pointerAction;
  state.pointerAction = null;
  if (!action) return;

  if (action.mode === 'shape') {
    let placed = false;
    if (state.currentShape) {
      const dx = (state.currentShape.x2 - state.currentShape.x1) * original.width;
      const dy = (state.currentShape.y2 - state.currentShape.y1) * original.height;
      // 番号は, クリックだけでも決まった大きさで置く.
      const clicked = Math.hypot(dx, dy) < 3;
      if (clicked && state.currentShape.type === 'badge') sizeBadgeAround(state.currentShape);
      if ((!clicked || state.currentShape.type === 'badge') && objects.length < MAX_OBJECTS) {
        objects.push(state.currentShape);
        state.selectedIndex = objects.length - 1;
        updateSelectionInspector();
        invalidateResult();
        pushHistory();
        placed = true;
      }
      state.currentShape = null;
    }
    drawEditor();
    if (placed) {
      showTab('props');
      afterPlacement();
    }
  } else if (action.mode === 'paint') {
    // 描いた線を, レイヤーの線の列へ足す. 列は作り直して入れ替える(履歴に残した前の列を書き換えないため).
    const stroke = state.currentStroke;
    state.currentStroke = null;
    const layer = stroke && objects.find((obj) => obj.id === stroke.targetId);
    if (layer) {
      const { targetId, ...saved } = stroke;
      layer.strokes = [...(layer.strokes || []), saved];
      updateSelectionInspector();
      invalidateResult();
      pushHistory();
    }
    drawEditor();
  } else if (action.mode === 'pen') {
    // 描いた線は選ばずに, 続けて描けるようペンの道具のままにする.
    if (state.currentShape && objects.length < MAX_OBJECTS) {
      objects.push(state.currentShape);
      updateSelectionInspector();
      invalidateResult();
      pushHistory();
    }
    state.currentShape = null;
    drawEditor();
  } else if (action.mode === 'text-new') {
    if (objects.length < MAX_OBJECTS) {
      objects.push(makeText(action.point));
      state.selectedIndex = objects.length - 1;
      updateSelectionInspector();
      loadFontsFor(objects).then(requestDraw);
      commitChange();
      showTab('props');
      afterPlacement();
      // 続けて文字を入力できるよう, 内容の入力欄へ移る.
      $('editTextContent').focus();
      $('editTextContent').select();
    }
  } else if (action.mode === 'handle') {
    updateSelectionInspector();
    invalidateResult();
    drawEditor();
    pushHistory();
  } else if (action.mode === 'object-move') {
    updateSelectionInspector();
    invalidateResult();
    drawEditor();
    pushHistory();
  } else if (action.mode === 'crop-new' && !action.moved) {
    state.crop = { ...action.initial };
    drawEditor();
  } else if (action.mode.startsWith('crop-')) {
    invalidateResult();
    pushHistory();
  }
}

// 操作を途中でやめ, 始める前の状態へ戻す(2本指の拡大縮小が始まったときなど).
export function cancelPointerAction() {
  const action = state.pointerAction;
  if (!action) return;
  state.pointerAction = null;
  const obj = selectedObject();
  if ((action.mode === 'object-move' || action.mode === 'handle') && obj && action.initial) {
    Object.assign(obj, action.initial);
  } else if (action.mode === 'shape' || action.mode === 'pen') {
    state.currentShape = null;
  } else if (action.mode === 'paint') {
    state.currentStroke = null;
  } else if (action.mode.startsWith('crop-')) {
    state.crop = { ...action.initial };
  }
  updateSelectionInspector();
  drawEditor();
}

['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => {
  original.addEventListener(eventName, finishPointerAction);
});
original.addEventListener('pointerleave', () => {
  if (!state.pointerAction) original.style.cursor = '';
});
