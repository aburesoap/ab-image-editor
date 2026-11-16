// 画面への復帰時の再描画と, 未保存の編集がある場合の警告.

import { original, result } from './dom.js';
import { state } from './state.js';
import { drawEditor } from './render.js';
import { convertImage, isBlankProbe, probeCanvas } from './convert.js';
import { hasUnsavedEdits } from './history.js';

// 保存先の選択などで別の画面へ移って戻った際に, メモリ不足などで空になったcanvasを元に戻す.
function refreshAfterReturn() {
  if (!state.sourceImage) return;
  drawEditor();
  if (state.converted && !state.converting && state.resultProbe && !isBlankProbe(state.resultProbe) && isBlankProbe(probeCanvas(result))) {
    convertImage();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAfterReturn();
});
window.addEventListener('pageshow', refreshAfterReturn);
original.addEventListener('contextrestored', refreshAfterReturn);
result.addEventListener('contextrestored', refreshAfterReturn);

window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedEdits()) return;
  event.preventDefault();
  event.returnValue = '';
});
