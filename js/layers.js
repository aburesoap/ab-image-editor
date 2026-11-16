// レイヤー一覧の表示. 前面のものを上に並べる. 操作の登録は layerlist.js で行う.

import { $ } from './dom.js';
import { objects, state } from './state.js';
import { isLineType, isText } from './geometry.js';
import { objectTypeLabel } from './shapes.js';

const STYLE_LABELS = { fill: '塗り', stroke: '枠線', window: '窓' };
const NAME_LIMIT = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  eye: [['path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  eyeOff: [['path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }], ['path', { d: 'M4 4l16 16' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 9 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  unlock: [['rect', { x: 5, y: 11, width: 14, height: 9 }], ['path', { d: 'M8 11V8a4 4 0 0 1 7.6-1.8' }]],
  up: [['path', { d: 'M6 15l6-7 6 7z', class: 'solid' }]],
  down: [['path', { d: 'M6 9l6 7 6-7z', class: 'solid' }]],
  trash: [['path', { d: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6' }]],
};

// 前回描いた内容. 変わっていなければ, 一覧を作り直さない(ドラッグ中は毎フレーム呼ばれるため).
let lastSignature = '';

// 一覧の表示名. テキストは内容の最初の行, 図形は種類と描画方法.
export function layerName(obj) {
  if (isText(obj)) {
    const line = obj.content.split('\n').map((part) => part.trim()).find(Boolean) || '';
    if (!line) return '（空のテキスト）';
    return line.length > NAME_LIMIT ? `${line.slice(0, NAME_LIMIT)}…` : line;
  }
  if (isLineType(obj.type)) return objectTypeLabel(obj.type);
  return `${objectTypeLabel(obj.type)}・${STYLE_LABELS[obj.style] || ''}`;
}

// 見本の色. 図形は見た目に使われている色, テキストは文字色と背景色.
function swatchOf(obj) {
  if (isText(obj)) return { kind: 'text', fg: obj.color, bg: obj.transparent ? '' : obj.bg };
  if (isLineType(obj.type)) return { kind: 'line', fg: obj.stroke, bg: '' };
  if (obj.style === 'stroke') return { kind: 'stroke', fg: obj.stroke, bg: '' };
  return { kind: obj.style === 'window' ? 'window' : 'fill', fg: obj.fill, bg: '' };
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  ICONS[name].forEach(([tag, attrs]) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
    svg.append(el);
  });
  return svg;
}

function toggleButton(act, pressed, onIcon, offIcon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-icon';
  button.dataset.act = act;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(pressed));
  button.append(icon(pressed ? onIcon : offIcon));
  return button;
}

// 重ね順を1つ動かすボタン. 一覧の上ほど前面なので, ▲で前面へ, ▼で背面へ動く.
function stepButton(act, iconName, label, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-icon layer-step';
  button.dataset.act = act;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.append(icon(iconName));
  return button;
}

// その行のオブジェクトを消すボタン. ロック中は, 誤って消さないよう押せない.
function deleteButton(locked) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-icon layer-delete';
  button.dataset.act = 'delete';
  const label = locked ? 'ロック中は削除できません' : '削除';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = locked;
  button.append(icon('trash'));
  return button;
}

function buildRow(obj, index) {
  const row = document.createElement('li');
  row.className = 'layer-row';
  row.dataset.index = String(index);
  row.classList.toggle('selected', index === state.selectedIndex);
  row.classList.toggle('is-hidden', Boolean(obj.hidden));
  row.classList.toggle('is-locked', Boolean(obj.locked));

  const grip = document.createElement('span');
  grip.className = 'layer-grip';
  grip.title = 'ドラッグして重ね順を変更';
  grip.setAttribute('aria-hidden', 'true');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'layer-main';
  main.dataset.act = 'select';
  if (index === state.selectedIndex) main.setAttribute('aria-current', 'true');
  main.title = '選択（Alt+↑↓ で重ね順を変更）';

  const sw = swatchOf(obj);
  const swatch = document.createElement('span');
  swatch.className = `layer-swatch sw-${sw.kind}`;
  swatch.style.setProperty('--fg', sw.fg);
  if (sw.bg) swatch.style.setProperty('--bg', sw.bg);
  if (sw.kind === 'text') swatch.textContent = 'A';
  swatch.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = layerName(obj);
  main.append(swatch, name);

  row.append(
    grip,
    main,
    stepButton('up', 'up', 'ひとつ前面へ', index === objects.length - 1),
    stepButton('down', 'down', 'ひとつ背面へ', index === 0),
    toggleButton('visible', !obj.hidden, 'eye', 'eyeOff', obj.hidden ? '表示する' : '隠す'),
    toggleButton('lock', Boolean(obj.locked), 'lock', 'unlock', obj.locked ? 'ロックを解除' : 'ロックする'),
    deleteButton(Boolean(obj.locked)),
  );
  return row;
}

function signature() {
  return `${state.selectedIndex}#${objects.map((obj) => {
    const sw = swatchOf(obj);
    return [obj.type, layerName(obj), sw.kind, sw.fg, sw.bg, obj.hidden ? 1 : 0, obj.locked ? 1 : 0].join('|');
  }).join('\n')}`;
}

// 一覧を現在のオブジェクトに合わせる. 選択中の行は, 見える位置までスクロールする.
export function renderLayerList() {
  const next = signature();
  if (next === lastSignature) return;
  lastSignature = next;
  const list = $('layerList');
  // 焦点のあった行を作り直した後も, 同じ行の同じボタンへ焦点を戻す.
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusAct = focused?.dataset.act;
  const focusIndex = focused?.closest('.layer-row')?.dataset.index;

  const rows = [];
  for (let index = objects.length - 1; index >= 0; index -= 1) rows.push(buildRow(objects[index], index));
  list.replaceChildren(...rows);
  $('layerEmpty').hidden = objects.length > 0;
  $('layerCount').textContent = objects.length ? String(objects.length) : '';

  if (focusAct) {
    const index = focusAct === 'select' && state.selectedIndex >= 0 ? state.selectedIndex : focusIndex;
    list.querySelector(`.layer-row[data-index="${index}"] [data-act="${focusAct}"]`)?.focus({ preventScroll: true });
  }
  const selected = list.querySelector('.layer-row.selected');
  if (selected) {
    // 一覧の中だけをスクロールする(パネル全体は動かさない). 一覧は position: relative なので, offsetTop は一覧の中の位置.
    const top = selected.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + selected.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + selected.offsetHeight - list.clientHeight;
    }
  }
}
