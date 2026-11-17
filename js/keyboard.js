// キーボードのショートカット.

import { TOOL_KEYS } from './constants.js';
import { state } from './state.js';
import { drawEditor } from './render.js';
import { updateSelectionInspector } from './inspector.js';
import { commitChange, redo, undo } from './history.js';
import {
  deleteSelected, groupSelected, selectAll, setTool, ungroupSelected,
} from './actions.js';
import { isMulti } from './selection.js';
import {
  clearStrokeSelection, selectedStrokeIndices, setStrokeSelection, strokeSelectMode, strokesWithout,
} from './paint-select.js';
import { zoomFit, zoomStep, zoomTo } from './stage.js';

// 拡大縮小のショートカット(Ctrl/⌘ と組み合わせる). 日本語配列では「+」が「;」のキーにあるため, どちらも受け付ける.
const ZOOM_KEYS = {
  '+': () => zoomStep(1), '=': () => zoomStep(1), ';': () => zoomStep(1),
  '-': () => zoomStep(-1), 0: zoomFit, 1: () => zoomTo(1),
};

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
  // 文字や数値の入力中は, ブラウザ標準の取り消しなどに任せる.
  const typing = tag === 'TEXTAREA' || tag === 'SELECT'
    || (tag === 'INPUT' && ['text', 'number'].includes(target.type));
  const modifier = event.ctrlKey || event.metaKey;
  const key = String(event.key || '').toLowerCase();

  if (modifier && !event.altKey && ZOOM_KEYS[key] && state.sourceImage && state.view === 'edit') {
    // ブラウザのページ全体の拡大縮小の代わりに, 作業領域を拡大縮小する.
    event.preventDefault();
    ZOOM_KEYS[key]();
  } else if (modifier && !event.altKey && !typing && key === 'a' && state.sourceImage) {
    // Ctrl+A: 作業領域で選べるものをすべて選ぶ. ペイントの線を選んでいるときは, そのレイヤーの線をすべて選ぶ.
    event.preventDefault();
    const paint = strokeSelectMode();
    if (paint) {
      setStrokeSelection(paint, (paint.strokes || []).map((_, i) => i));
      drawEditor();
    } else {
      selectAll();
    }
  } else if ((key === 'delete' || key === 'backspace') && !typing && strokeSelectMode()
    && selectedStrokeIndices(strokeSelectMode()).length) {
    // 選んだ線だけを消す(レイヤーは消さない).
    event.preventDefault();
    const paint = strokeSelectMode();
    if (paint.locked) return;
    paint.strokes = strokesWithout(paint, selectedStrokeIndices(paint));
    clearStrokeSelection();
    updateSelectionInspector();
    commitChange();
  } else if (key === 'escape' && strokeSelectMode() && selectedStrokeIndices(strokeSelectMode()).length) {
    clearStrokeSelection();
    drawEditor();
  } else if (modifier && !event.altKey && !typing && key === 'g' && state.sourceImage) {
    // Ctrl+G でグループにし, Ctrl+Shift+G で解く.
    event.preventDefault();
    if (event.shiftKey) ungroupSelected();
    else groupSelected();
  } else if (modifier && !typing && (key === 'z' || key === 'y')) {
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redo();
    else undo();
  } else if (!modifier && !event.altKey && !typing && state.sourceImage && TOOL_KEYS[key]) {
    // V: 選択, C: 切り抜き, R: 図形, T: テキスト.
    event.preventDefault();
    setTool(TOOL_KEYS[key]);
  } else if ((key === 'delete' || key === 'backspace') && !typing && (state.selectedIndex >= 0 || isMulti())) {
    // Macのキーボードの「delete」は Backspace として届く.
    event.preventDefault();
    deleteSelected();
  } else if (key === 'escape') {
    if (state.selectedIndex >= 0 || isMulti()) {
      state.selectedIndex = -1;
      updateSelectionInspector();
      drawEditor();
      if (typing && target.blur) target.blur();
    } else if (state.sourceImage && state.tool !== 'select') {
      setTool('select');
    }
  }
});
