// 仕上げ設定(明るさ, 色数など)の読み書きと, 設定欄の表示の同期.

import { DITHER_METHODS } from './constants.js';
import { limited } from './validate.js';
import { $ } from './dom.js';
import { state } from './state.js';

export function updateLabels() {
  $('maxSideVal').textContent = `${$('maxSide').value} px`;
  $('colorsVal').textContent = `${$('colors').value} 色`;
  $('brightnessVal').textContent = $('brightness').value;
  $('contrastVal').textContent = (Number($('contrast').value) / 100).toFixed(2);
  $('maxSide').disabled = $('keepOriginalResolution').checked;
  // 色数削減がOFFのときは, 色数とディザリング方式の設定は結果に影響しない.
  const quantizeOn = $('quantizeEnabled').checked;
  $('colors').disabled = !quantizeOn;
  $('method').disabled = !quantizeOn;
  // 詳細設定を閉じていても, 減色が効いていることが分かるようにする.
  $('advancedState').textContent = quantizeOn ? '減色 ON' : '';
}

export function syncGrayscaleButton() {
  $('grayscale').textContent = `グレースケール ${state.grayscale ? 'ON' : 'OFF'}`;
  $('grayscale').classList.toggle('active', state.grayscale);
  $('grayscale').setAttribute('aria-pressed', String(state.grayscale));
}

export function readConversionSettings() {
  return {
    brightness: Number($('brightness').value),
    contrast: Number($('contrast').value),
    grayscale: state.grayscale,
    quantize: $('quantizeEnabled').checked,
    colors: Number($('colors').value),
    method: $('method').value,
  };
}

// 書き出す前に, 画素の加工(色調整・減色)が要るか. 要らなければ, 編集中の見た目をそのまま書き出せる.
export function needsProcessing() {
  const settings = readConversionSettings();
  return settings.quantize || settings.grayscale || settings.brightness !== 0 || settings.contrast !== 100;
}

export function readConversionState() {
  return {
    maxSide: $('maxSide').value, colors: $('colors').value,
    brightness: $('brightness').value, contrast: $('contrast').value,
    method: $('method').value, quantizeEnabled: $('quantizeEnabled').checked,
    keepOriginalResolution: $('keepOriginalResolution').checked, grayscale: state.grayscale,
  };
}

export function applyConversion(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid project');
  ['maxSide', 'colors', 'brightness', 'contrast'].forEach((id) => {
    if (id in raw) $(id).value = limited(raw[id], Number($(id).value), Number($(id).min), Number($(id).max));
  });
  if (DITHER_METHODS.includes(raw.method)) $('method').value = raw.method;
  ['quantizeEnabled', 'keepOriginalResolution'].forEach((id) => {
    if (id in raw) $(id).checked = Boolean(raw[id]);
  });
  if ('grayscale' in raw) state.grayscale = Boolean(raw.grayscale);
}
