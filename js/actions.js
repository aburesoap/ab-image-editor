// 道具・表示・パネルの切り替えと, オブジェクトの操作(削除・複製・重ね順など).

import {
  MAX_OBJECTS, PAPER_DEFAULT, TOOL_BUTTONS, TOOL_HINTS,
} from './constants.js';
import { $, original, setStatus } from './dom.js';
import { newObjectId, objects, selectedObject, state } from './state.js';
import { isBadge, isEffectType, moveObject } from './geometry.js';
import { nextBadgeNumber, syncWindowStyleOption } from './shapes.js';
import { drawEditor } from './render.js';
import { updateStageView } from './stage.js';
import { updateSelectionInspector } from './inspector.js';
import { convertImage } from './convert.js';
import { commitChange, pushHistory } from './history.js';

// 操作の案内. 図形の道具では, 番号とぼかし・モザイクの置き方が違うので, 種類に合わせる.
function toolHint() {
  if (state.tool !== 'shape') return TOOL_HINTS[state.tool];
  if (state.shapeType === 'badge') return TOOL_HINTS.badge;
  if (isEffectType(state.shapeType)) return TOOL_HINTS.effect;
  return TOOL_HINTS.shape;
}

// 選んでいる道具に合わせて, 道具の強調, オプションバー, 操作の案内, カーソルを切り替える.
export function updateToolUI() {
  Object.entries(TOOL_BUTTONS).forEach(([id, tool]) => {
    $(id).classList.toggle('active', state.tool === tool);
    $(id).setAttribute('aria-pressed', String(state.tool === tool));
  });
  $('optCrop').hidden = state.tool !== 'crop';
  $('optShape').hidden = state.tool !== 'shape';
  $('optPen').hidden = state.tool !== 'pen';
  $('optLock').hidden = state.tool !== 'shape' && state.tool !== 'text';
  $('toolHint').textContent = toolHint();
  original.className = `tool-${state.tool}`;
}

// 道具を切り替える. 選択以外の道具に切り替えたときは, 選択を解除する.
export function setTool(tool, keepSelection = false) {
  state.tool = tool;
  state.view = 'edit';
  state.pointerAction = null;
  state.currentShape = null;
  if (tool !== 'select' && !keepSelection) state.selectedIndex = -1;
  updateToolUI();
  updateStageView();
  updateSelectionInspector();
  drawEditor();
}

// 図形・テキストを置いたあとの処理. 「連続して配置」がOFFなら, 選択の道具へ戻る.
export function afterPlacement() {
  if (state.toolLock) return;
  setTool('select', true);
}

// ステージの表示を, 編集と仕上がりの間で切り替える. 仕上がりが未作成なら, 変換してから表示する.
export async function setView(view) {
  state.view = view;
  state.pointerAction = null;
  updateStageView();
  if (view === 'result' && !state.converted) await convertImage();
}

// 右のパネルのタブを切り替える. 画面の狭い端末では, 閉じていたパネルも開く.
export function showTab(name) {
  const props = name === 'props';
  $('tabProps').classList.toggle('active', props);
  $('tabFinish').classList.toggle('active', !props);
  $('paneProps').hidden = !props;
  $('paneFinish').hidden = props;
  $('panel').classList.remove('collapsed');
}

// タブを押したときの処理. 開いているタブをもう一度押すと, 画面の狭い端末ではパネルを閉じる.
export function onTabClick(name) {
  const active = name === 'props' ? !$('paneProps').hidden : !$('paneFinish').hidden;
  if (active && !$('panel').classList.contains('collapsed')) $('panel').classList.add('collapsed');
  else showTab(name);
}

// 新規の図形の種類に合わせて, 描画方法の選択肢を整える.
export function syncShapeOptions() {
  syncWindowStyleOption($('shapeStyle'), state.shapeType);
  // 番号とぼかし・モザイクには, 描画方法が無い.
  $('shapeStyle').disabled = state.shapeType === 'badge' || isEffectType(state.shapeType);
  $('toolHint').textContent = toolHint();
}

// オブジェクトを, 重ね順の別の位置(添字)へ移す. 選択は同じオブジェクトに付いたまま動く.
export function moveObjectTo(from, to) {
  if (from < 0 || from >= objects.length) return;
  const target = Math.max(0, Math.min(objects.length - 1, to));
  if (target === from) return;
  const selected = selectedObject();
  const [item] = objects.splice(from, 1);
  objects.splice(target, 0, item);
  state.selectedIndex = selected ? objects.indexOf(selected) : -1;
  updateSelectionInspector();
  commitChange();
}

// 選択中のオブジェクトを, 重ね順の別の位置へ移す.
export function reorderSelected(kind) {
  const from = state.selectedIndex;
  if (from < 0) return;
  let to = from;
  if (kind === 'front') to = objects.length - 1;
  else if (kind === 'forward') to = from + 1;
  else if (kind === 'backward') to = from - 1;
  else to = 0;
  moveObjectTo(from, to);
}

// レイヤー一覧などから, オブジェクトを選ぶ. 選択以外の道具を持っていれば, 選択の道具へ持ち替える.
export function selectObject(index) {
  state.selectedIndex = index >= 0 && index < objects.length ? index : -1;
  if (state.tool !== 'select' || state.view !== 'edit') {
    setTool('select', true);
  } else {
    updateSelectionInspector();
    drawEditor();
  }
}

// 表示・非表示を切り替える. 隠したオブジェクトは, プレビューにも書き出しにも描かない.
export function toggleHidden(index) {
  const obj = objects[index];
  if (!obj) return;
  obj.hidden = !obj.hidden;
  updateSelectionInspector();
  commitChange();
}

// ロックを切り替える. ロック中はプレビュー上で選べず, 動かせない(見た目は変わらないので, 変換結果はそのまま).
export function toggleLocked(index) {
  const obj = objects[index];
  if (!obj) return;
  obj.locked = !obj.locked;
  updateSelectionInspector();
  drawEditor();
  pushHistory();
}

// 指定した添字のオブジェクトを消す. ロック中のものは, 誤って消さないよう削除しない(ロックを解除してから削除する).
// 別のオブジェクトを選んでいた場合は, 選択をそのオブジェクトに付けたままにする.
export function deleteObjectAt(index) {
  const obj = objects[index];
  if (!obj) return;
  if (obj.locked) {
    setStatus('ロック中のため削除できません. レイヤー一覧の錠前で解除してください');
    return;
  }
  const selected = selectedObject();
  objects.splice(index, 1);
  state.selectedIndex = selected && selected !== obj ? objects.indexOf(selected) : -1;
  updateSelectionInspector();
  commitChange();
}

export function deleteSelected() {
  deleteObjectAt(state.selectedIndex);
}

export function duplicateSelected() {
  const source = selectedObject();
  if (!source || objects.length >= MAX_OBJECTS) return;
  // 複製したものは, 隠れていたりロックされていたりしても, 見えて動かせる状態にする.
  const copy = { ...source, id: newObjectId(), hidden: false, locked: false };
  // 番号を複製したときは, 次の番号にする.
  if (isBadge(copy)) copy.number = nextBadgeNumber();
  moveObject(copy, 0.02, 0.02);
  objects.splice(state.selectedIndex + 1, 0, copy);
  state.selectedIndex += 1;
  updateSelectionInspector();
  commitChange();
}

// 白地を, いちばん下(元画像のすぐ上)に足して選ぶ. 白地の上に描けば, 簡単なお絵描きにも使える.
export function addPaper() {
  if (!state.sourceImage || objects.length >= MAX_OBJECTS) return;
  objects.unshift({
    id: newObjectId(),
    type: 'paper',
    style: 'fill',
    fill: PAPER_DEFAULT,
    stroke: PAPER_DEFAULT,
    lineWidth: 0,
    opacity: 1,
    rotation: 0,
    hidden: false,
    locked: false,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  });
  state.selectedIndex = 0;
  if (state.tool !== 'select') setTool('select', true);
  updateSelectionInspector();
  showTab('props');
  commitChange();
}

export function clearAll() {
  objects.length = 0;
  state.currentShape = null;
  state.selectedIndex = -1;
  updateSelectionInspector();
  commitChange();
}
