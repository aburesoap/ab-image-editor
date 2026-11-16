// ペンの道具のオプションバー(種類・色・太さ)の表示. 選んでいる種類の, 直前に使った値に合わせる.
// 編集パネル(inspector.js)と道具の切り替え(actions.js)の両方から使うため, 小さなモジュールに分けている.

import { PEN_WIDTH_MAX_PX } from './constants.js';
import { $ } from './dom.js';
import { state } from './state.js';

export function syncPenOptions() {
  const look = state.lastPen[state.penType];
  $('penType').value = state.penType;
  $('penColor').value = look.stroke;
  $('penWidth').value = String(Math.max(1, Math.min(PEN_WIDTH_MAX_PX, Math.round(look.widthPx))));
  $('penWidthVal').textContent = `${$('penWidth').value} px`;
}
