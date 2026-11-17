// 起動処理. 各モジュールを読み込み, 初期表示を整える.

import { TEXT_DEFAULTS, sliders } from './constants.js';
import { ensureFont, fontStack, loadStartupFonts } from './fonts.js';
import { $ } from './dom.js';
import { requestDraw } from './render.js';
import { updateLabels } from './settings.js';
import { observeStage, updateStageView } from './stage.js';
import { updateToolUI } from './actions.js';
import './controls.js';
import './open.js';
import './blank.js';
import './layerlist.js';
import './zoom.js';
import './pointer.js';
import './keyboard.js';
import './export.js';
import './project.js';
import './session.js';
import './autosave.js';

sliders.forEach((id) => $(id).addEventListener('input', updateLabels));
updateLabels();
updateToolUI();
updateStageView();
observeStage();

loadStartupFonts();
if (document.fonts) {
  document.fonts.addEventListener('loadingdone', requestDraw);
  // 文字の描画に使う太さを先に読み込んでおく.
  ensureFont(TEXT_DEFAULTS.font)
    .then(() => document.fonts.load(`${TEXT_DEFAULTS.weight} 16px ${fontStack(TEXT_DEFAULTS.font)}`, TEXT_DEFAULTS.content))
    .catch(() => {});
}
