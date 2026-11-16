// ボタンや入力欄の操作の登録. 画像の読み込みは open.js で行う.

import { FULL_CROP, TOOL_BUTTONS, colorFields, defaults, inspectorFields, orderButtons } from './constants.js';
import { rotateImage } from './rotate.js';
import { $, setStatus } from './dom.js';
import { state } from './state.js';
import { drawEditor } from './render.js';
import { syncGrayscaleButton, updateLabels, needsProcessing } from './settings.js';
import { convertImage, invalidateResult } from './convert.js';
import { applyInspector, updateSelectionInspector } from './inspector.js';
import { initColorField } from './colorpicker.js';
import {
  commitChange,
  pushHistory,
  redo,
  scheduleHistory,
  undo,
} from './history.js';
import {
  clearAll,
  deleteSelected,
  duplicateSelected,
  onTabClick,
  reorderSelected,
  setTool,
  setView,
  syncShapeOptions,
} from './actions.js';

// 色の欄を, 自作のカラーピッカーを開くボタンにする. 値の読み書きとイベントは, 標準の入力欄と同じ.
colorFields.forEach((id) => initColorField($(id)));

// 道具・新規の図形・表示の切り替え.
Object.entries(TOOL_BUTTONS).forEach(([id, tool]) => {
  $(id).addEventListener('click', () => setTool(tool));
});
$('shapeType').addEventListener('change', () => {
  state.shapeType = $('shapeType').value;
  syncShapeOptions();
});
$('toolLock').addEventListener('change', () => { state.toolLock = $('toolLock').checked; });
$('viewEdit').addEventListener('click', () => setView('edit'));
$('viewResult').addEventListener('click', () => setView('result'));
$('showResult').addEventListener('click', () => setView('result'));
$('convert').addEventListener('click', convertImage);

// 履歴・切り抜き・オブジェクトの操作.
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('rotateLeft').addEventListener('click', () => rotateImage(-1));
$('rotateRight').addEventListener('click', () => rotateImage(1));
$('cropReset').addEventListener('click', () => {
  state.crop = { ...FULL_CROP };
  commitChange();
});
$('clearObjects').addEventListener('click', clearAll);
$('duplicateObject').addEventListener('click', duplicateSelected);
$('deleteObject').addEventListener('click', deleteSelected);
orderButtons.forEach((id) => {
  $(id).addEventListener('click', () => reorderSelected(id === 'bringFront' ? 'front' : 'back'));
});
inspectorFields.forEach((id) => {
  $(id).addEventListener('input', () => { applyInspector(); scheduleHistory(); });
  $(id).addEventListener('change', () => {
    applyInspector();
    // 範囲外の入力が補正された場合などに, 入力欄の表示も合わせる.
    updateSelectionInspector();
    pushHistory();
  });
});

// 右のパネルのタブと, ファイルメニュー.
$('tabProps').addEventListener('click', () => onTabClick('props'));
$('tabFinish').addEventListener('click', () => onTabClick('finish'));
document.addEventListener('click', (event) => {
  const menu = $('fileMenu');
  if (menu.open && !$('fileMenuSummary').contains(event.target)) menu.open = false;
});

// 仕上げ設定.
$('grayscale').addEventListener('click', () => {
  if (!state.sourceImage) return;
  state.grayscale = !state.grayscale;
  syncGrayscaleButton();
  pushHistory();
  // グレースケールは, 切り替えた時点で変換して, 仕上がりを表示する(加工が何も無くなったときは, 編集の表示へ戻る).
  invalidateResult();
  setView(needsProcessing() ? 'result' : 'edit');
});

$('reset').addEventListener('click', () => {
  Object.entries(defaults).forEach(([key, value]) => {
    if (typeof value === 'boolean') $(key).checked = value;
    else $(key).value = value;
  });
  state.grayscale = false;
  syncGrayscaleButton();
  updateLabels();
  drawEditor();
  invalidateResult();
  pushHistory();
  setStatus(state.sourceImage
    ? '設定を初期値に戻しました. 必要に応じて再変換してください'
    : '設定を初期値に戻しました. 画像を選択してください');
});

// 連続して動かすスライダーは, 操作が落ち着いた時点(または確定時)で履歴に残す.
['maxSide', 'colors', 'brightness', 'contrast'].forEach((id) => {
  $(id).addEventListener('input', () => { invalidateResult(); scheduleHistory(); });
  $(id).addEventListener('change', () => { invalidateResult(); pushHistory(); });
});
['method', 'quantizeEnabled', 'keepOriginalResolution'].forEach((id) => {
  $(id).addEventListener('change', () => {
    updateLabels();
    invalidateResult();
    pushHistory();
  });
});
