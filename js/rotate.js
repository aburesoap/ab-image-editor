// 元画像の回転(90°単位). 元画像そのものは書き換えず, 向きを state.rotation に持つ.
// 図形・テキスト・切り抜き範囲も, 画像と一緒に回す.

import { objects, state } from './state.js';
import { isOrientedType, isText, normalizeAngle, sourceSize, turnPoint } from './geometry.js';
import { setStatus } from './dom.js';
import { zoomFit } from './stage.js';
import { updateSelectionInspector } from './inspector.js';
import { commitChange } from './history.js';

// 図形・テキストを, 画像と一緒に90°回す. W, H は回す前の画像の大きさ(px).
// 大きさ(文字サイズ・線幅)は画像の幅に対する比率で持っているため, 幅が変わる分を補正する.
function turnObject(obj, dir, W, H) {
  const widthRatio = W / H;
  if (isText(obj)) {
    const p = turnPoint(obj.x, obj.y, dir);
    obj.x = p.x;
    obj.y = p.y;
    obj.size *= widthRatio;
    obj.rotation = normalizeAngle(Number(obj.rotation || 0) + 90 * dir);
    return;
  }
  // 元画像のレイヤーは, 向き(state.rotation)で回して描くので, 何もしない.
  if (obj.type === 'base' || obj.type === 'group') return;
  obj.lineWidth = Number(obj.lineWidth || 0) * widthRatio;
  if (obj.type === 'paint') {
    // ペイントの線は, 画像上の位置で持っているので, 点を1つずつ回す. 列は作り直す(履歴に残した前の列を書き換えないため).
    obj.strokes = (obj.strokes || []).map((stroke) => {
      const points = [];
      for (let i = 0; i + 1 < stroke.points.length; i += 2) {
        const p = turnPoint(stroke.points[i], stroke.points[i + 1], dir);
        points.push(p.x, p.y);
      }
      return { ...stroke, width: Number(stroke.width || 0) * widthRatio, points };
    });
    return;
  }
  if (isOrientedType(obj.type)) {
    // 三角形・星・吹き出し・太矢印は上下や左右が対称でないため, 枠の縦横は保ったまま, 中心を移して角度を90°足す.
    const center = turnPoint((obj.x1 + obj.x2) / 2, (obj.y1 + obj.y2) / 2, dir);
    const halfX = ((obj.x2 - obj.x1) / 2) * (W / H);
    const halfY = ((obj.y2 - obj.y1) / 2) * (H / W);
    obj.x1 = center.x - halfX;
    obj.x2 = center.x + halfX;
    obj.y1 = center.y - halfY;
    obj.y2 = center.y + halfY;
    obj.rotation = normalizeAngle(Number(obj.rotation || 0) + 90 * dir);
    return;
  }
  // 長方形・角丸長方形・楕円・ひし形・直線・矢印は, 両端(対角)の点を回せば, 角度はそのままで同じ見た目になる.
  const a = turnPoint(obj.x1, obj.y1, dir);
  const b = turnPoint(obj.x2, obj.y2, dir);
  obj.x1 = a.x;
  obj.y1 = a.y;
  obj.x2 = b.x;
  obj.y2 = b.y;
}

function turnCrop(crop, dir) {
  const a = turnPoint(crop.x, crop.y, dir);
  const b = turnPoint(crop.x + crop.w, crop.y + crop.h, dir);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

// dir が1なら右(時計回り)へ, -1なら左へ90°回す.
export function rotateImage(dir) {
  if (!state.sourceImage || state.pointerAction) return;
  const { w, h } = sourceSize();
  objects.forEach((obj) => turnObject(obj, dir, w, h));
  state.crop = turnCrop(state.crop, dir);
  state.rotation = (state.rotation + (dir > 0 ? 90 : 270)) % 360;
  updateSelectionInspector();
  commitChange();
  // 画像の縦横が入れ替わるため, 全体が見える表示に戻す.
  zoomFit();
  const size = sourceSize();
  setStatus(`画像を${dir > 0 ? '右' : '左'}へ90°回転しました：${size.w} × ${size.h} px`);
}
