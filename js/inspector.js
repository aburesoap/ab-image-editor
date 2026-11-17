// 選択中のオブジェクトの編集パネル. 欄への表示と, 触った項目の反映.

import {
  BADGE_MAX,
  EFFECT_MAX_PX,
  EFFECT_MIN_PX,
  OUTLINE_MAX_PX,
  TEXT_DEFAULTS,
  TEXT_MAX_PX,
  TEXT_MIN_PX,
  geometryFields,
  inspectorControls,
  inspectorFields,
} from './constants.js';
import { $, setDisabled } from './dom.js';
import { fieldSnapshot, objects, selectedObject, state } from './state.js';
import { FONT_KEYS, TEXT_FONTS, WEIGHT_LABELS, FONT_WEIGHTS, fontWeights, nearestWeight } from './fonts.js';
import {
  canCutout, isBadge, isEffectType, isImage, isLineType, isPaint, isPaper, isPenType, isText, moveObject, objectCenter, refWidth,
} from './geometry.js';
import { loadFontsFor } from './text.js';
import { objectTypeLabel, syncWindowStyleOption } from './shapes.js';
import { requestDraw } from './render.js';
import { invalidateResult } from './convert.js';
import { renderLayerList } from './layers.js';
import { syncColorPicker } from './colorpicker.js';
import { syncPenOptions, syncPenTarget } from './pen-options.js';

const fieldValue = (id) => {
  const el = $(id);
  return String(el.type === 'checkbox' ? el.checked : el.value);
};

function rememberFields() {
  inspectorFields.forEach((id) => { fieldSnapshot[id] = fieldValue(id); });
}

const touched = (id) => fieldValue(id) !== fieldSnapshot[id];

// スライダーの現在値を, ラベルへ表示する.
function updateInspectorLabels() {
  $('editTextSizeVal').textContent = `${$('editTextSize').value} px`;
  $('editOpacityVal').textContent = `${$('editOpacity').value}%`;
  $('editLineWidthVal').textContent = `${$('editLineWidth').value} px`;
  $('editStrengthVal').textContent = `${$('editStrength').value} px`;
  const outline = Number($('editTextOutlineWidth').value);
  $('editTextOutlineWidthVal').textContent = outline ? `${outline} px` : 'なし';
}

// フォントと太さの選択肢は, フォントの一覧(fonts.js)から作る.
$('editTextFont').replaceChildren(...FONT_KEYS.map((key) => new Option(TEXT_FONTS[key].label, key)));
$('editTextWeight').replaceChildren(...FONT_WEIGHTS.map((weight) => new Option(WEIGHT_LABELS[weight], String(weight))));

// 太さの選択肢を, そのフォントで使えるものだけ選べるようにする. 1つしか無ければ, 欄ごと無効にする.
function syncWeightOptions(fontKey) {
  const usable = fontWeights(fontKey);
  [...$('editTextWeight').options].forEach((option) => { option.disabled = !usable.includes(Number(option.value)); });
  $('editTextWeight').disabled = usable.length < 2;
}

export function updateSelectionInspector() {
  const obj = selectedObject();
  $('clearObjects').disabled = !state.sourceImage || objects.length === 0;
  $('propBody').hidden = !obj;
  $('propEmpty').hidden = Boolean(obj);
  setDisabled(inspectorControls, !obj);
  renderLayerList();
  syncPenTarget();
  if (!obj) {
    syncColorPicker();
    return;
  }

  const textObject = isText(obj);
  const effect = isEffectType(obj.type);
  const badge = isBadge(obj);
  $('textFields').hidden = !textObject;
  // ぼかし・モザイクは色を持たず, 強さだけを持つ. 番号は, 丸の色・数字の色・番号を持つ.
  // ペイントレイヤーは, 中の線をまとめて持つだけで, 色や大きさの欄は無い(不透明度と重ね順だけ).
  const paint = isPaint(obj);
  // 画像レイヤーは, 位置・大きさ・角度・不透明度だけを持つ.
  const image = isImage(obj);
  $('paintFields').hidden = !paint;
  $('imageFields').hidden = !image;
  $('shapeFields').hidden = textObject || effect || paint || image;
  $('effectFields').hidden = !effect;
  // ペン・蛍光ペンは線の色と太さだけ, 白地は色だけを持つ. 白地は画像全体に固定なので, 位置・大きさの欄も出さない.
  const pen = isPenType(obj.type);
  const paper = isPaper(obj);
  $('badgeFields').hidden = !badge;
  $('strokeFields').hidden = badge || paper;
  $('fillField').hidden = pen;
  $('strokeField').hidden = paper;
  $('styleField').hidden = pen;
  $('numericFields').hidden = paper || paint;
  $('cutoutField').hidden = !canCutout(obj.type);
  $('editCutout').checked = obj.cutout === true;
  $('cutoutNote').hidden = obj.cutout !== true;
  $('editFillLabel').textContent = badge ? '丸の色' : paper ? '色' : '塗り色';
  $('editStrokeLabel').textContent = badge ? '数字の色' : pen ? '色' : '線の色';
  $('sizeFields').hidden = textObject;
  const flags = [obj.hidden ? '非表示' : '', obj.locked ? 'ロック中' : ''].filter(Boolean).join('・');
  $('selectedObjectName').textContent = `${objectTypeLabel(obj.type)}（重ね順 ${state.selectedIndex + 1} / ${objects.length}）${flags ? ` ${flags}` : ''}`;
  const setNumber = (id, value) => { $(id).value = Number(value).toFixed(1).replace(/\.0$/, ''); };
  const center = objectCenter(obj);
  setNumber('editX', center.x * 100);
  setNumber('editY', center.y * 100);
  $('editAngle').value = Math.round(Number(obj.rotation || 0));
  $('editOpacity').value = Math.round(Number(obj.opacity) * 100);

  if (textObject) {
    $('editTextContent').value = obj.content;
    $('editTextColor').value = obj.color;
    $('editTextBg').value = obj.bg;
    $('editTextTransparent').checked = obj.transparent;
    $('editTextBg').disabled = obj.transparent;
    $('editTextOutline').value = obj.outline || TEXT_DEFAULTS.outline;
    $('editTextOutlineWidth').value = Math.max(0, Math.min(OUTLINE_MAX_PX, Math.round(Number(obj.outlineWidth || 0) * refWidth())));
    const sizePx = Math.max(TEXT_MIN_PX, Math.min(TEXT_MAX_PX, Math.round(obj.size * refWidth())));
    $('editTextSize').value = sizePx;
    $('editTextFont').value = obj.font;
    syncWeightOptions(obj.font);
    $('editTextWeight').value = String(obj.weight);
  } else {
    setNumber('editWidth', Math.abs(obj.x2 - obj.x1) * 100);
    setNumber('editHeight', Math.abs(obj.y2 - obj.y1) * 100);
    $('editFill').value = obj.fill || '#ffffff';
    $('editStroke').value = obj.stroke || '#ffffff';
    $('editStyle').value = obj.style || 'fill';
    $('editLineWidth').value = Math.max(1, Math.round(Number(obj.lineWidth || 0) * refWidth()));
    $('editStrength').value = Math.max(EFFECT_MIN_PX, Math.min(EFFECT_MAX_PX, Math.round(Number(obj.strength || 0) * refWidth())));
    $('editBadgeNumber').value = String(obj.number ?? 0);
    syncWindowStyleOption($('editStyle'), obj.type);
  }
  updateInspectorLabels();

  // 重ね順の端では, それ以上動かせないボタンを無効にする.
  const atFront = state.selectedIndex === objects.length - 1;
  const atBack = state.selectedIndex === 0;
  $('bringFront').disabled = atFront;
  $('sendBack').disabled = atBack;
  setDisabled(geometryFields, Boolean(obj.locked));
  $('deleteObject').disabled = Boolean(obj.locked);
  $('lockNote').hidden = !obj.locked;
  rememberFields();
  syncColorPicker();
}

// 編集パネルのうち, ユーザーが実際に触った項目だけを選択中のオブジェクトへ反映する.
// 触った色や太さは, 次に置く図形・テキストへ引き継ぐ.
export function applyInspector() {
  const obj = selectedObject();
  if (!obj) return;
  const number = (id, min, max) => {
    const raw = $(id).value;
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
  };
  const ref = refWidth();
  // 触った色や太さは, 同じ種類の次のものへ引き継ぐ. ペン・蛍光ペンは種類ごとに覚え, 白地は引き継がない.
  const pen = isPenType(obj.type);
  let last = state.lastShape;
  if (isText(obj)) last = state.lastText;
  else if (isBadge(obj)) last = state.lastBadge;
  else if (isPaper(obj) || isPaint(obj) || isImage(obj) || pen) last = {};

  if (touched('editX')) {
    const value = number('editX', -100, 200);
    if (value !== null) moveObject(obj, value / 100 - objectCenter(obj).x, 0);
  }
  if (touched('editY')) {
    const value = number('editY', -100, 200);
    if (value !== null) moveObject(obj, 0, value / 100 - objectCenter(obj).y);
  }
  if (touched('editAngle')) {
    const value = number('editAngle', -180, 180);
    if (value !== null) obj.rotation = value;
  }
  if (touched('editCutout') && canCutout(obj.type)) {
    obj.cutout = $('editCutout').checked;
    $('cutoutNote').hidden = !obj.cutout;
  }
  if (touched('editOpacity')) {
    const value = number('editOpacity', 0, 100);
    if (value !== null) {
      obj.opacity = value / 100;
      last.opacity = obj.opacity;
    }
  }

  if (isText(obj)) {
    if (touched('editTextContent')) obj.content = $('editTextContent').value;
    if (touched('editTextColor')) {
      obj.color = $('editTextColor').value;
      last.color = obj.color;
    }
    if (touched('editTextBg')) {
      obj.bg = $('editTextBg').value;
      last.bg = obj.bg;
    }
    if (touched('editTextOutline')) {
      obj.outline = $('editTextOutline').value;
      last.outline = obj.outline;
    }
    if (touched('editTextOutlineWidth')) {
      const value = number('editTextOutlineWidth', 0, OUTLINE_MAX_PX);
      if (value !== null) {
        obj.outlineWidth = value / ref;
        last.outlineWidthPx = value;
      }
    }
    if (touched('editTextTransparent')) {
      obj.transparent = $('editTextTransparent').checked;
      last.transparent = obj.transparent;
    }
    if (touched('editTextSize')) {
      const value = number('editTextSize', TEXT_MIN_PX, TEXT_MAX_PX);
      if (value !== null) {
        obj.size = value / ref;
        last.sizePx = value;
      }
    }
    if (touched('editTextFont') && FONT_KEYS.includes($('editTextFont').value)) {
      obj.font = $('editTextFont').value;
      // 選んだフォントに今の太さが無ければ, 最も近い太さに直す.
      obj.weight = nearestWeight(obj.font, obj.weight);
      last.font = obj.font;
      last.weight = obj.weight;
    }
    if (touched('editTextWeight')) {
      const weight = Number($('editTextWeight').value);
      if (fontWeights(obj.font).includes(weight)) {
        obj.weight = weight;
        last.weight = weight;
      }
    }
    loadFontsFor([obj]).then(requestDraw);
  } else {
    // 直線・矢印は始点から終点への向きが見た目を決めるため, 元の向きを保ったまま大きさだけを更新する.
    if (touched('editWidth')) {
      const value = number('editWidth', 0, 300);
      if (value !== null) {
        const cx = (obj.x1 + obj.x2) / 2;
        const sign = obj.x2 >= obj.x1 ? 1 : -1;
        obj.x1 = cx - sign * value / 200;
        obj.x2 = cx + sign * value / 200;
      }
    }
    if (touched('editHeight')) {
      const value = number('editHeight', 0, 300);
      if (value !== null) {
        const cy = (obj.y1 + obj.y2) / 2;
        const sign = obj.y2 >= obj.y1 ? 1 : -1;
        obj.y1 = cy - sign * value / 200;
        obj.y2 = cy + sign * value / 200;
      }
    }
    if (touched('editStrength')) {
      const value = number('editStrength', EFFECT_MIN_PX, EFFECT_MAX_PX);
      if (value !== null) {
        obj.strength = value / ref;
        state.lastEffect.strengthPx = value;
      }
    }
    if (touched('editBadgeNumber')) {
      const value = number('editBadgeNumber', 0, BADGE_MAX);
      if (value !== null) obj.number = Math.round(value);
    }
    if (touched('editFill')) {
      obj.fill = $('editFill').value;
      last.fill = obj.fill;
    }
    if (touched('editStroke')) {
      obj.stroke = $('editStroke').value;
      last.stroke = obj.stroke;
    }
    if (touched('editStyle')) {
      obj.style = $('editStyle').value;
      if (isLineType(obj.type) && obj.style === 'window') obj.style = 'stroke';
      // 次に置く図形の描画方法も, 同じものにする.
      $('shapeStyle').value = obj.style;
    }
    if (touched('editLineWidth')) {
      const value = number('editLineWidth', 1, 80);
      if (value !== null) {
        obj.lineWidth = value / ref;
        last.lineWidthPx = value;
      }
    }
    if (pen) {
      // ペンの道具のオプションバーにも, 同じ色と太さを反映する.
      if (touched('editStroke')) state.lastPen[obj.type].stroke = obj.stroke;
      if (touched('editLineWidth')) state.lastPen[obj.type].widthPx = Math.round(obj.lineWidth * ref);
      if (state.penType === obj.type) syncPenOptions();
    }
  }
  updateInspectorLabels();
  // 反映した値を, 次に比べる基準にする. 基準を選んだ時点のままにすると, スライダーを動かして元の値へ戻したとき,
  // 「触っていない」と見なされて最後の値が反映されず, 途中の値(縁取り1pxなど)が残ってしまう.
  rememberFields();
  // 文字の内容や色が変わると, 一覧の名前と見本も変わる.
  renderLayerList();
  requestDraw();
  invalidateResult();
}
