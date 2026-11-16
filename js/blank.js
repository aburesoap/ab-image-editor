// 白紙から始める. 選んだ大きさの透明な画像を元画像として開き, いちばん下に白地を敷く.
// 白地はふつうのレイヤーなので, 色を変えたり消したり(背景が透明な画像になる)できる.

import { $, setStatus } from './dom.js';
import { state } from './state.js';
import { drawEditor } from './render.js';
import { updateSelectionInspector } from './inspector.js';
import { markSaved, resetHistory } from './history.js';
import { addPaper } from './actions.js';
import { openImage } from './open.js';

export const BLANK_MIN = 16;
export const BLANK_MAX = 8000;

const dialog = $('blankDialog');
const custom = () => $('blankForm').elements.blankSize.value === 'custom';

function syncCustomFields() {
  $('blankWidth').disabled = !custom();
  $('blankHeight').disabled = !custom();
}

// 選んだ大きさ. 自分で入力した値が範囲の外なら null.
function chosenSize() {
  if (!custom()) {
    const [w, h] = $('blankForm').elements.blankSize.value.split('x').map(Number);
    return { w, h };
  }
  const read = (id) => {
    const value = Number($(id).value);
    return Number.isInteger(value) && value >= BLANK_MIN && value <= BLANK_MAX ? value : null;
  };
  const w = read('blankWidth');
  const h = read('blankHeight');
  return w && h ? { w, h } : null;
}

export function openBlankDialog() {
  syncCustomFields();
  $('blankNote').classList.remove('lock-note');
  $('blankNote').textContent = 'いちばん下に白地のレイヤーを敷きます. 白地を消すと, 背景が透明な画像になります';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeBlankDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

// 指定の大きさの白紙を作って開く. 作れたら true.
export async function startBlank(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || !(await openImage(blob, '白紙', '作成'))) return false;
  addPaper();
  // 白地を敷いた状態を, 白紙の最初の状態にする(元に戻すで白地が消えないように. 未保存の扱いにもしない).
  state.selectedIndex = -1;
  updateSelectionInspector();
  drawEditor();
  resetHistory();
  markSaved();
  setStatus(`白紙を作りました：${w} × ${h} px`);
  return true;
}

$('blankForm').addEventListener('change', syncCustomFields);
$('blankForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const size = chosenSize();
  if (!size) {
    $('blankNote').classList.add('lock-note');
    $('blankNote').textContent = `幅と高さは, ${BLANK_MIN}〜${BLANK_MAX} の整数で入力してください`;
    return;
  }
  closeBlankDialog();
  await startBlank(size.w, size.h);
});
$('blankCancel').addEventListener('click', closeBlankDialog);
$('startBlank').addEventListener('click', openBlankDialog);
$('newBlank').addEventListener('click', () => {
  $('fileMenu').open = false;
  openBlankDialog();
});
