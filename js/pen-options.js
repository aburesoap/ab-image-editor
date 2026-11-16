// ペンの道具のオプションバー(種類・色・太さ)の表示. 選んでいる種類の, 直前に使った値に合わせる.
// 編集パネル(inspector.js)と道具の切り替え(actions.js)の両方から使うため, 小さなモジュールに分けている.

import { PEN_WIDTH_MAX_PX } from './constants.js';
import { $ } from './dom.js';
import { selectedObject, state } from './state.js';
import { isPaint } from './geometry.js';
import { layerName } from './layers.js';

// 描き先のペイントレイヤー(選んでいるもの). 無ければ null.
export function activePaint() {
  const obj = selectedObject();
  return obj && isPaint(obj) ? obj : null;
}

// 描き先の表示と, 消しゴムを選べるか(ペイントレイヤーの中でだけ使える)を合わせる.
export function syncPenTarget() {
  const paint = activePaint();
  $('penTarget').textContent = paint ? `描き先: ${layerName(paint)}` : '描き先: 1本ずつの線';
  $('penTarget').classList.toggle('active', Boolean(paint));
  $('penType').querySelector('option[value="eraser"]').disabled = !paint;
  if (!paint && state.penType === 'eraser') {
    state.penType = 'pen';
    syncPenOptions();
  }
}

export function syncPenOptions() {
  const look = state.lastPen[state.penType];
  $('penType').value = state.penType;
  $('penColor').value = look.stroke;
  $('penWidth').value = String(Math.max(1, Math.min(PEN_WIDTH_MAX_PX, Math.round(look.widthPx))));
  $('penWidthVal').textContent = `${$('penWidth').value} px`;
  // 消しゴムに色は無い.
  $('penColor').disabled = state.penType === 'eraser';
}
