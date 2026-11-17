// レイヤー一覧の操作. 行を押して選択, 目と錠前で表示とロックの切り替え, ごみ箱で削除, つまみのドラッグで重ね順を変更.
// 一覧は前面のものが上なので, 行の位置(上から)とオブジェクトの添字(背面から)は逆順になる.

import { $ } from './dom.js';
import { objects, state } from './state.js';
import {
  deleteObjectAt, dropObject, selectObject, setTool, stepObject, toggleHidden, toggleLocked,
} from './actions.js';
import { toggleSelected } from './selection.js';
import { updateSelectionInspector } from './inspector.js';
import { drawEditor } from './render.js';

const list = $('layerList');
// ドラッグ中に一覧の端へ近づいたとき, 自動でスクロールする範囲(px)と速さ.
const EDGE = 28;
const EDGE_SPEED = 8;
let drag = null;

const rowIndex = (el) => Number(el.closest('.layer-row').dataset.index);
const rows = () => [...list.querySelectorAll('.layer-row')];

list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-act]');
  if (!button || !state.sourceImage) return;
  const index = rowIndex(button);
  const act = button.dataset.act;
  if (act === 'fold') {
    // グループの開閉. 画面の表示だけなので, 履歴には残さない.
    const id = objects[index].id;
    if (state.collapsedIds.has(id)) state.collapsedIds.delete(id);
    else state.collapsedIds.add(id);
    updateSelectionInspector();
    list.querySelector(`.layer-row[data-index="${index}"] [data-act="fold"]`)?.focus({ preventScroll: true });
  } else if (act === 'visible') toggleHidden(index);
  else if (act === 'lock') toggleLocked(index);
  else if (act === 'delete') {
    deleteObjectAt(index);
    // 続けて消せるよう, 同じ位置に来た行(無ければ1つ上の行)の削除ボタンへ焦点を移す.
    const next = list.querySelector(`.layer-row[data-index="${index}"]`) || list.querySelector(`.layer-row[data-index="${index - 1}"]`);
    next?.querySelector('[data-act="delete"]')?.focus({ preventScroll: true });
  }
  else if (act === 'up' || act === 'down') {
    const obj = objects[index];
    stepObject(index, act === 'up' ? 1 : -1);
    // 続けて押せるよう, 動かした先の行の同じボタンへ焦点を移す. 端で無効になった場合は, 行そのものへ.
    const row = list.querySelector(`.layer-row[data-index="${objects.indexOf(obj)}"]`);
    const next = row?.querySelector(`[data-act="${act}"]`);
    (next && !next.disabled ? next : row?.querySelector('.layer-main'))?.focus({ preventScroll: true });
  } else if (event.ctrlKey || event.metaKey || event.shiftKey) {
    // Ctrl・Shift+クリックで, 選択に足す・外す.
    if (state.tool !== 'select' || state.view !== 'edit') setTool('select', true);
    toggleSelected(index);
    updateSelectionInspector();
    drawEditor();
  } else selectObject(index);
});

// ↑↓で隣の行へ, Alt+↑↓で重ね順を1つ移す.
list.addEventListener('keydown', (event) => {
  const button = event.target.closest('.layer-main');
  if (!button || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  const index = rowIndex(button);
  if (event.altKey) {
    // Alt+↑↓ で, 同じグループの中で重ね順を1つ動かす.
    if (state.selectedIndex !== index) selectObject(index);
    stepObject(index, event.key === 'ArrowUp' ? 1 : -1);
  } else {
    // ↑↓ で, 一覧の上下の行へ(閉じたグループの中は飛ばす).
    const all = rows();
    const position = all.indexOf(button.closest('.layer-row'));
    const next = all[position + (event.key === 'ArrowUp' ? -1 : 1)];
    if (next) selectObject(Number(next.dataset.index));
  }
});

// ---- つまみのドラッグ ----
function clearMarks() {
  rows().forEach((row) => row.classList.remove('drop-before', 'drop-after', 'dragging'));
}

// ポインタの位置から, 差し込む位置(上から何番目の行の前か)を求める.
function slotAt(clientY) {
  const all = rows();
  for (let i = 0; i < all.length; i += 1) {
    const rect = all[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return all.length;
}

function markSlot(slot) {
  clearMarks();
  const all = rows();
  all[drag.position]?.classList.add('dragging');
  // 元の位置のすぐ上下へ差し込んでも, 順番は変わらない.
  if (slot === drag.position || slot === drag.position + 1) return;
  if (slot < all.length) all[slot].classList.add('drop-before');
  else all[all.length - 1]?.classList.add('drop-after');
}

list.addEventListener('pointerdown', (event) => {
  const grip = event.target.closest('.layer-grip');
  if (!grip || !state.sourceImage || event.button > 0) return;
  event.preventDefault();
  const index = rowIndex(grip);
  const position = rows().indexOf(grip.closest('.layer-row'));
  if (state.selectedIndex !== index) selectObject(index);
  // 選択で一覧が作り直されるため, つまみではなく一覧でポインタを捕まえる.
  list.setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, index, position, slot: position };
  markSlot(position);
});

list.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const rect = list.getBoundingClientRect();
  if (event.clientY < rect.top + EDGE) list.scrollTop -= EDGE_SPEED;
  else if (event.clientY > rect.bottom - EDGE) list.scrollTop += EDGE_SPEED;
  drag.slot = slotAt(event.clientY);
  markSlot(drag.slot);
});

function finishDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { index, position, slot } = drag;
  drag = null;
  clearMarks();
  if (event.type !== 'pointerup') return;
  // 元の位置のすぐ上下へ差し込んでも, 順番は変わらない.
  if (slot === position || slot === position + 1) return;
  // 差し込んだ所のすぐ下の行の前面へ移し, その行と同じグループに入れる. いちばん下なら最背面へ.
  const below = rows()[slot];
  dropObject(index, below ? objects[Number(below.dataset.index)] : null);
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => list.addEventListener(name, finishDrag));
