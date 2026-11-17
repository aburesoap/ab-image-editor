// 整列のガイド. オブジェクトを動かしている間, 動かしているものの端・中心を,
// ほかのオブジェクトや画像の端・中心にそろう位置へ吸い付け, そろった線を表示する.
// オプションバー(選択の道具)の「整列のガイド」で入り切りでき, Alt を押している間は吸い付けない.

import { original } from './dom.js';
import { objects, state } from './state.js';
import { isFullLayer, screenScale } from './geometry.js';
import { objectBounds } from './selection.js';

const SETTING_KEY = 'image-editor-guides';
// 吸い付く距離(画面上のpx).
const SNAP_DISTANCE = 6;

export function guidesEnabled() {
  try {
    return window.localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setGuidesEnabled(on) {
  try {
    window.localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // 覚えられなくても, 今の画面では切り替えたとおりに動く.
  }
}

// そろえる相手の線(canvas上のpx). 画像の端と中心, 動かしていない見えているオブジェクトの端と中心.
function targetLines(moving) {
  const W = original.width;
  const H = original.height;
  const xs = [0, W / 2, W];
  const ys = [0, H / 2, H];
  objects.forEach((obj) => {
    if (moving.includes(obj) || obj.hidden || isFullLayer(obj)) return;
    const b = objectBounds(obj);
    xs.push(b.left, (b.left + b.right) / 2, b.right);
    ys.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  });
  return { xs, ys };
}

// 動かしているもの全体の端・中心のうち, 相手の線に最も近いものを探す. 吸い付く距離より遠ければ null.
function nearest(edges, targets, reach) {
  let best = null;
  edges.forEach((edge) => {
    targets.forEach((target) => {
      const diff = target - edge;
      if (Math.abs(diff) <= reach && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, line: target };
    });
  });
  return best;
}

// 動かしているもの(今の位置)を, 吸い付く位置へずらす量(canvas上のpx)と, 表示する線を求める.
export function snapMove(moving) {
  if (!moving.length) return { dx: 0, dy: 0, lines: null };
  const box = moving.map(objectBounds).reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }));
  const { xs, ys } = targetLines(moving);
  const reach = SNAP_DISTANCE * screenScale();
  const sx = nearest([box.left, (box.left + box.right) / 2, box.right], xs, reach);
  const sy = nearest([box.top, (box.top + box.bottom) / 2, box.bottom], ys, reach);
  const dx = sx ? sx.diff : 0;
  const dy = sy ? sy.diff : 0;
  // 吸い付いた後の位置で, そろっている線をすべて表示する(左端と中心が同時にそろう場合など).
  const after = {
    left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy,
  };
  const eps = 0.5;
  // 同じ位置の線は1本にまとめる.
  const unique = (list) => [...new Set(list.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  const lines = {
    x: sx ? unique(xs.filter((x) => [after.left, (after.left + after.right) / 2, after.right].some((e) => Math.abs(e - x) < eps))) : [],
    y: sy ? unique(ys.filter((y) => [after.top, (after.top + after.bottom) / 2, after.bottom].some((e) => Math.abs(e - y) < eps))) : [],
  };
  return { dx, dy, lines: lines.x.length || lines.y.length ? lines : null };
}

// 吸い付けるか. ガイドが入っていて, Alt を押していないとき.
export const shouldSnap = (event) => guidesEnabled() && !event.altKey;

// 表示中のガイドの線. 動かしている間だけ持つ.
export function setGuideLines(lines) {
  state.guideLines = lines;
}
