// 元に戻す・やり直す, 履歴, 保存状態(未保存の編集の判定).

import { HISTORY_LIMIT } from './constants.js';
import { $ } from './dom.js';
import { future, history, objects, selectedObject, state } from './state.js';
import { loadFontsFor } from './text.js';
import { drawEditor, requestDraw } from './render.js';
import { applyConversion, readConversionState, syncGrayscaleButton, updateLabels } from './settings.js';
import { invalidateResult } from './convert.js';
import { updateSelectionInspector } from './inspector.js';
import { clearStrokeSelection } from './paint-select.js';

// 履歴の1件分. 切り抜き, 図形・テキスト, 仕上げ設定をまとめて保持する.
export function snapshot() {
  return {
    crop: { ...state.crop },
    rotation: state.rotation,
    objects: objects.map((obj) => ({ ...obj })),
    conversion: readConversionState(),
  };
}

// 履歴が変わったときに呼ぶ関数(自動保存). history.js から自動保存を読み込むと循環するため, 登録してもらう.
const changeListeners = [];
export const onHistoryChange = (fn) => changeListeners.push(fn);

function updateHistoryUI() {
  changeListeners.forEach((fn) => fn());
  $('undo').disabled = history.length < 2;
  $('redo').disabled = future.length === 0;
}

export function pushHistory() {
  if (!state.sourceImage) return;
  const next = snapshot();
  if (history.length && JSON.stringify(history[history.length - 1]) === JSON.stringify(next)) return;
  history.push(next);
  if (history.length > HISTORY_LIMIT) history.shift();
  future.length = 0;
  updateHistoryUI();
}

export function scheduleHistory() {
  window.clearTimeout(state.historyTimer);
  state.historyTimer = window.setTimeout(pushHistory, 350);
}

// 編集内容が確定したときの共通処理.
export function commitChange() {
  drawEditor();
  invalidateResult();
  pushHistory();
}

// 選択していたオブジェクトが残っていれば, 元に戻したあとも選んだままにする.
export function restoreSnapshot(snap) {
  const selectedId = selectedObject()?.id;
  const multiIds = [...state.multiIds];
  // 線の番号がずれることがあるため, ペイントの線の選択は外す.
  clearStrokeSelection();
  applyConversion(snap.conversion);
  state.crop = { ...snap.crop };
  // 向きが変わると画像の縦横が入れ替わるため, 全体が見える表示に戻す.
  const turned = (snap.rotation || 0) !== state.rotation;
  state.rotation = snap.rotation || 0;
  if (turned) state.zoom.fit = true;
  objects.length = 0;
  objects.push(...snap.objects.map((obj) => ({ ...obj })));
  state.selectedIndex = selectedId === undefined ? -1 : objects.findIndex((obj) => obj.id === selectedId);
  // 複数を選んでいたときは, 残っているものを選んだままにする.
  const kept = multiIds.filter((id) => objects.some((obj) => obj.id === id));
  if (kept.length >= 2) {
    state.selectedIndex = -1;
    state.multiIds = kept;
  } else if (kept.length === 1) {
    state.selectedIndex = objects.findIndex((obj) => obj.id === kept[0]);
  }
  updateSelectionInspector();
  syncGrayscaleButton();
  updateLabels();
  loadFontsFor(objects).then(requestDraw);
  drawEditor();
  invalidateResult();
}

export function resetHistory() {
  window.clearTimeout(state.historyTimer);
  history.length = 0;
  future.length = 0;
  pushHistory();
}

export function undo() {
  if (history.length < 2) return;
  window.clearTimeout(state.historyTimer);
  pushHistory();
  future.push(history.pop());
  restoreSnapshot(history[history.length - 1]);
  updateHistoryUI();
}

export function redo() {
  const next = future.pop();
  if (!next) return;
  history.push(next);
  restoreSnapshot(next);
  updateHistoryUI();
}

function currentSignature() {
  return JSON.stringify(snapshot());
}

export function markSaved() {
  state.savedSignature = currentSignature();
}

// 画像・図形・文字・切り抜き・仕上げ設定のいずれかが, 最後の保存から変わっているか.
export function hasUnsavedEdits() {
  return Boolean(state.sourceImage) && currentSignature() !== state.savedSignature;
}
