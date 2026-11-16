// 値の検証. 読み込んだデータや入力欄の値を, 型と範囲を確認して取り出す.

import { COLOR_PATTERN } from './constants.js';

// 読み込んだJSONは信頼せず, 型と範囲を確認してから反映する.
export function finite(value, fallback) {
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const number = Number(value);
  return value !== null && Number.isFinite(number) ? number : fallback;
}

export function limited(value, fallback, min, max) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

export function colorOr(value, fallback) {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback;
}
