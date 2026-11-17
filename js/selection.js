// 複数の選択. 選択の道具での範囲選択(ドラッグで囲む), Shift・Ctrl+クリックでの足し引き, すべて選択.
// 1つだけのときは state.selectedIndex, 2つ以上のときは state.multiIds に持つ(state.js).

import { objects, state } from './state.js';
import { isFullLayer } from './geometry.js';
import { objectFrame } from './handles.js';

export const isMulti = () => state.multiIds.length >= 2;

// 選んでいるオブジェクトの一覧(背面から順).
export function selectedObjects() {
  if (isMulti()) {
    const ids = new Set(state.multiIds);
    return objects.filter((obj) => ids.has(obj.id));
  }
  const obj = state.selectedIndex >= 0 ? objects[state.selectedIndex] : null;
  return obj ? [obj] : [];
}

export const isSelectedIndex = (index) => (isMulti()
  ? Boolean(objects[index]) && state.multiIds.includes(objects[index].id)
  : index === state.selectedIndex);

// 指定のオブジェクトを選ぶ. 0個なら選択を外し, 1個なら1つだけの選択にする.
export function selectMany(list) {
  const unique = [...new Set(list)].filter((obj) => objects.includes(obj));
  if (unique.length < 2) {
    state.selectedIndex = unique.length ? objects.indexOf(unique[0]) : -1;
    return;
  }
  state.selectedIndex = -1;
  // 背面から順に並べておく(複製などの順番をそろえるため).
  state.multiIds = objects.filter((obj) => unique.includes(obj)).map((obj) => obj.id);
}

// 選択に足す. すでに選んでいれば外す.
export function toggleSelected(index) {
  const obj = objects[index];
  if (!obj) return;
  const current = selectedObjects();
  selectMany(current.includes(obj) ? current.filter((item) => item !== obj) : [...current, obj]);
}

// 作業領域で選べるもの. 隠したもの・ロックしたもの・画像全体に広がるもの(白地・ペイント)は除く.
export const selectableOnStage = (obj) => !obj.hidden && !obj.locked && !isFullLayer(obj);

// オブジェクトの枠(回転を含む)を囲む, 画面に沿った長方形(canvas上のpx).
export function objectBounds(obj) {
  const frame = objectFrame(obj);
  const xs = [];
  const ys = [];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
    xs.push(frame.cx + sx * frame.hx * frame.cos - sy * frame.hy * frame.sin);
    ys.push(frame.cy + sx * frame.hx * frame.sin + sy * frame.hy * frame.cos);
  });
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

// 範囲(canvas上のpx)に触れている, 作業領域で選べるもの.
export function objectsInRect(rect) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return objects.filter((obj) => {
    if (!selectableOnStage(obj)) return false;
    const b = objectBounds(obj);
    return b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom;
  });
}
