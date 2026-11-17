// キーボードのショートカット.

import { TOOL_KEYS } from './constants.js';
import { state } from './state.js';
import { drawEditor } from './render.js';
import { updateSelectionInspector } from './inspector.js';
import { redo, undo } from './history.js';
import { deleteSelected, selectAll, setTool } from './actions.js';
import { isMulti } from './selection.js';
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
    // Ctrl+A: 作業領域で選べるものをすべて選ぶ.
    event.preventDefault();
    selectAll();
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
