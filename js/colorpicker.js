// 自作のカラーピッカー. ブラウザ標準の色選択の代わりに, ページ内の小さな窓で色を選ぶ.
// 色の欄(ボタン)は value を持ち, 標準の入力欄と同じく input / change イベントを発生させる.
// そのため, 編集パネルなど呼び出し側の処理は, 標準の入力欄と同じ書き方のまま使える.

import { COLOR_PATTERN } from './constants.js';
import { $ } from './dom.js';

const RECENT_KEY = 'iMageEditor.recentColors';
const RECENT_LIMIT = 12;
const PRESETS = [
  '#ffffff', '#c7ccd1', '#7f7f7f', '#3a3a3a', '#000000', '#202020',
  '#c24e42', '#e8833a', '#f4c95d', '#4c9a52', '#2d8c8c', '#2d579e',
  '#6b4fa0', '#d9668f', '#8a5a3c', '#f4f1e9', '#dce7f5', '#aab7ff',
];

const pop = $('colorPopover');
const area = $('cpArea');
const cursor = $('cpCursor');
const hue = $('cpHue');
const hexInput = $('cpHex');
const oldSwatch = $('cpOld');
const newSwatch = $('cpNew');

// 開いている色の欄と, 選択中の色(色相・彩度・明度). 彩度0でも色相を失わないよう, 16進数とは別に持つ.
const picker = { anchor: null, initial: '', h: 0, s: 0, v: 0, dragging: false };
let recent = loadRecent();

// ---- 色の変換 ----
export function normalizeHex(value) {
  let text = String(value || '').trim().toLowerCase();
  if (!text.startsWith('#')) text = `#${text}`;
  if (/^#[0-9a-f]{3}$/.test(text)) text = `#${[...text.slice(1)].map((c) => c + c).join('')}`;
  return COLOR_PATTERN.test(text) ? text : null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsv([r, g, b]) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

// ---- 最近使った色(この端末のブラウザにだけ保存する) ----
function loadRecent() {
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.map(normalizeHex).filter(Boolean).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function addRecent(hex) {
  recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // 保存できない環境では, 開いている間だけ覚えておく.
  }
  renderSwatches($('cpRecent'), recent);
}

function renderSwatches(container, colors) {
  const buttons = colors.map((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cp-swatch';
    button.dataset.color = color;
    button.title = color;
    button.setAttribute('aria-label', color);
    button.style.backgroundColor = color;
    return button;
  });
  container.replaceChildren(...buttons);
  if (container.id === 'cpRecent') $('cpRecentLabel').hidden = colors.length === 0;
}

// ---- 色の欄 ----
const nativeValue = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'value');

function paintField(field) {
  const hex = nativeValue.get.call(field);
  field.querySelector('.cf-swatch').style.backgroundColor = hex;
  field.querySelector('.cf-hex').textContent = hex.toUpperCase();
}

// ボタンを色の欄にする. value への代入で, 見本と表示も更新する.
export function initColorField(field) {
  const swatch = document.createElement('span');
  swatch.className = 'cf-swatch';
  const label = document.createElement('span');
  label.className = 'cf-hex';
  field.replaceChildren(swatch, label);
  field.type = 'button';
  field.classList.add('color-field');
  field.setAttribute('aria-haspopup', 'dialog');
  field.setAttribute('aria-expanded', 'false');
  const initial = normalizeHex(field.getAttribute('value')) || '#000000';
  Object.defineProperty(field, 'value', {
    configurable: true,
    get: () => nativeValue.get.call(field),
    set: (value) => {
      const hex = normalizeHex(value) || nativeValue.get.call(field) || initial;
      nativeValue.set.call(field, hex);
      paintField(field);
    },
  });
  field.value = initial;
  field.addEventListener('click', () => {
    if (picker.anchor === field) closeColorPicker(false);
    else openColorPicker(field);
  });
}

// ---- 窓の表示 ----
function render() {
  const hex = picker.anchor ? picker.anchor.value : '#000000';
  area.style.backgroundColor = `hsl(${picker.h} 100% 50%)`;
  cursor.style.left = `${picker.s * 100}%`;
  cursor.style.top = `${(1 - picker.v) * 100}%`;
  cursor.style.backgroundColor = hex;
  area.setAttribute('aria-valuetext', `彩度 ${Math.round(picker.s * 100)}%, 明るさ ${Math.round(picker.v * 100)}%`);
  hue.value = String(Math.round(picker.h));
  // 入力中の文字は上書きしない.
  if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
  newSwatch.style.backgroundColor = hex;
  oldSwatch.style.backgroundColor = picker.initial;
}

function place() {
  const anchor = picker.anchor;
  if (!anchor) return;
  if (anchor.disabled || anchor.getClientRects().length === 0) {
    closeColorPicker(false);
    return;
  }
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const viewW = document.documentElement.clientWidth;
  const viewH = window.innerHeight;
  const left = Math.max(margin, Math.min(rect.left, viewW - width - margin));
  let top = rect.bottom + 6;
  if (top + height > viewH - margin) top = Math.max(margin, rect.top - height - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function emit(type) {
  if (picker.anchor) picker.anchor.dispatchEvent(new Event(type, { bubbles: true }));
}

// 色相・彩度・明度から色を決めて反映する. commit がtrueなら, 確定(change)も伝える.
function applyHsv(commit) {
  if (!picker.anchor) return;
  picker.anchor.value = rgbToHex(hsvToRgb(picker.h, picker.s, picker.v));
  render();
  emit('input');
  if (commit) emit('change');
}

// 16進数の色をそのまま反映する(見本・カラーコード).
function applyHex(hex, commit) {
  if (!picker.anchor || !hex) return;
  const hsv = rgbToHsv(hexToRgb(hex));
  // 無彩色では色相が決まらないため, 直前の色相を残す.
  picker.h = hsv.s ? hsv.h : picker.h;
  picker.s = hsv.s;
  picker.v = hsv.v;
  picker.anchor.value = hex;
  render();
  emit('input');
  if (commit) emit('change');
}

export function openColorPicker(field) {
  if (picker.anchor) closeColorPicker(false);
  picker.anchor = field;
  picker.initial = field.value;
  const hsv = rgbToHsv(hexToRgb(field.value));
  Object.assign(picker, hsv);
  field.setAttribute('aria-expanded', 'true');
  pop.hidden = false;
  render();
  place();
  area.focus({ preventScroll: true });
}

export function closeColorPicker(returnFocus) {
  const anchor = picker.anchor;
  if (!anchor) return;
  if (anchor.value !== picker.initial) addRecent(anchor.value);
  picker.anchor = null;
  picker.dragging = false;
  pop.hidden = true;
  anchor.setAttribute('aria-expanded', 'false');
  if (returnFocus) anchor.focus();
}

// 開いている色の欄が隠れたり無効になったりした場合(選択の解除, 元に戻すなど)は, 窓を閉じる.
export function syncColorPicker() {
  if (picker.anchor) place();
}

// ---- 操作 ----
function pickFromArea(event) {
  const rect = area.getBoundingClientRect();
  picker.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  picker.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
}

area.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  area.focus({ preventScroll: true });
  area.setPointerCapture(event.pointerId);
  picker.dragging = true;
  pickFromArea(event);
  applyHsv(false);
});
area.addEventListener('pointermove', (event) => {
  if (!picker.dragging) return;
  pickFromArea(event);
  applyHsv(false);
});
['pointerup', 'pointercancel'].forEach((name) => area.addEventListener(name, () => {
  if (!picker.dragging) return;
  picker.dragging = false;
  emit('change');
}));

const AREA_KEYS = {
  ArrowLeft: ['s', -1], ArrowRight: ['s', 1], ArrowUp: ['v', 1], ArrowDown: ['v', -1],
};
area.addEventListener('keydown', (event) => {
  const move = AREA_KEYS[event.key];
  if (!move) return;
  event.preventDefault();
  const [key, dir] = move;
  picker[key] = Math.max(0, Math.min(1, picker[key] + dir * (event.shiftKey ? 0.1 : 0.01)));
  applyHsv(false);
});
area.addEventListener('keyup', (event) => {
  if (AREA_KEYS[event.key]) emit('change');
});

hue.addEventListener('input', () => {
  picker.h = Number(hue.value) % 360;
  applyHsv(false);
});
hue.addEventListener('change', () => emit('change'));

hexInput.addEventListener('input', () => {
  // 6桁がそろった時点で反映する. 3桁の省略形は, 確定(Enter・欄の外へ移動)時に反映する.
  if (/^#?[0-9a-f]{6}$/i.test(hexInput.value.trim())) applyHex(normalizeHex(hexInput.value), false);
});
hexInput.addEventListener('change', () => {
  const hex = normalizeHex(hexInput.value);
  if (hex) applyHex(hex, true);
  hexInput.value = picker.anchor ? picker.anchor.value.toUpperCase() : '';
});
hexInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    hexInput.dispatchEvent(new Event('change'));
    hexInput.select();
  }
});

pop.addEventListener('click', (event) => {
  const swatch = event.target.closest('.cp-swatch');
  if (swatch) applyHex(normalizeHex(swatch.dataset.color), true);
});
oldSwatch.addEventListener('click', () => applyHex(picker.initial, true));

// Esc で閉じる. 窓の中のキー操作は, 道具の切り替えなどのショートカットへ渡さない.
pop.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeColorPicker(true);
  } else if (!event.ctrlKey && !event.metaKey) {
    event.stopPropagation();
  }
});

// 窓の外を押したら閉じる.
document.addEventListener('pointerdown', (event) => {
  if (!picker.anchor) return;
  if (pop.contains(event.target) || picker.anchor.contains(event.target)) return;
  closeColorPicker(false);
}, true);
window.addEventListener('resize', place);
document.addEventListener('scroll', place, true);

renderSwatches($('cpPresets'), PRESETS);
renderSwatches($('cpRecent'), recent);
