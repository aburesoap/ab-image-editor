// 作業領域の拡大・縮小と移動の操作.
// Ctrl(⌘)+ホイール・トラックパッドのピンチで拡大縮小, ホイールで移動, スペース+ドラッグ・中ボタンのドラッグで移動,
// タッチ操作では2本指で拡大縮小と移動. 道具の操作より先に受け取るため, 作業領域で捕捉段階のイベントを使う.

import { $ } from './dom.js';
import { state } from './state.js';
import { panBy, zoomBy, zoomFit, zoomFrom, zoomLevel, zoomState, zoomStep, zoomTo } from './stage.js';
import { cancelPointerAction } from './pointer.js';

const box = $('stageCanvas');
// ホイール1回あたりの拡大率の変化. 大きな値(マウスのホイール)は抑え, 細かい値(ピンチ)はそのまま使う.
const WHEEL_SPEED = 0.006;
const WHEEL_LIMIT = 50;
const LINE_PX = 16;

let spaceHeld = false;
let pan = null;
const touches = new Map();
let pinch = null;

const editing = () => Boolean(state.sourceImage) && state.view === 'edit';
const point = (event) => ({ x: event.clientX, y: event.clientY });

// ---- ホイール ----
box.addEventListener('wheel', (event) => {
  if (!editing()) return;
  const unit = event.deltaMode === 1 ? LINE_PX : 1;
  if (event.ctrlKey || event.metaKey) {
    // トラックパッドのピンチも, Ctrlキー付きのホイールとして届く.
    event.preventDefault();
    const delta = Math.max(-WHEEL_LIMIT, Math.min(WHEEL_LIMIT, event.deltaY * unit));
    zoomBy(Math.exp(-delta * WHEEL_SPEED), point(event));
  } else if (!state.zoom.fit) {
    event.preventDefault();
    // Shift+ホイールは横へ動かす.
    const sideways = event.shiftKey && !event.deltaX;
    panBy(-(sideways ? event.deltaY : event.deltaX) * unit, -(sideways ? 0 : event.deltaY) * unit);
  }
}, { passive: false });

// ---- スペースキー ----
function setSpace(held) {
  spaceHeld = held;
  box.classList.toggle('pan-ready', held);
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || !editing()) return;
  const target = event.target;
  const tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
  // 入力欄・選択肢・チェックボックスでは, スペースキー本来の動作を優先する.
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || target?.isContentEditable) return;
  event.preventDefault();
  // ボタンに焦点があると, 離したときに押されてしまうため外しておく.
  if (tag === 'BUTTON' || tag === 'SUMMARY') target.blur();
  if (!spaceHeld) setSpace(true);
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && spaceHeld) {
    event.preventDefault();
    setSpace(false);
  }
});
window.addEventListener('blur', () => setSpace(false));

// ---- ドラッグでの移動(スペース+ドラッグ, 中ボタン) ----
function startPan(event) {
  event.preventDefault();
  event.stopPropagation();
  box.setPointerCapture(event.pointerId);
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  box.classList.add('panning');
}

function endPan(event) {
  if (!pan || event.pointerId !== pan.pointerId) return;
  pan = null;
  box.classList.remove('panning');
}

// ---- 2本指の操作 ----
function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = {
    start: zoomState(),
    level: zoomLevel(),
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

function updatePinch() {
  const [a, b] = [...touches.values()];
  const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  zoomFrom(pinch.start, pinch.level * (distance / pinch.distance), pinch.mid, mid);
}

box.addEventListener('pointerdown', (event) => {
  if (!editing()) return;
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, point(event));
    if (touches.size === 2) {
      // 1本目の指で始めた道具の操作は取り消して, 拡大縮小に切り替える.
      cancelPointerAction();
      startPinch();
    }
    if (touches.size >= 2) {
      event.preventDefault();
      event.stopPropagation();
      box.setPointerCapture(event.pointerId);
    }
    return;
  }
  if (spaceHeld || event.button === 1) startPan(event);
}, true);

// 中ボタンを押したときの自動スクロールを止める.
box.addEventListener('mousedown', (event) => {
  if (event.button === 1) event.preventDefault();
});

box.addEventListener('pointermove', (event) => {
  if (pan && event.pointerId === pan.pointerId) {
    event.stopPropagation();
    panBy(event.clientX - pan.x, event.clientY - pan.y);
    pan.x = event.clientX;
    pan.y = event.clientY;
    return;
  }
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, point(event));
    if (pinch) {
      event.stopPropagation();
      if (touches.size >= 2) updatePinch();
    }
  }
}, true);

function releasePointer(event) {
  endPan(event);
  if (!touches.delete(event.pointerId)) return;
  if (pinch) {
    // 指を1本離しても, 残りの指で道具の操作が始まらないよう, すべて離すまで拡大縮小の扱いを続ける.
    event.stopPropagation();
    if (touches.size === 0) pinch = null;
    else if (touches.size >= 2) startPinch();
  }
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => box.addEventListener(name, releasePointer, true));

// ---- ボタン ----
$('zoomIn').addEventListener('click', () => zoomStep(1));
$('zoomOut').addEventListener('click', () => zoomStep(-1));
$('zoomFit').addEventListener('click', zoomFit);
// 倍率の表示を押すと, 100%(元画像の1pxを画面の1pxで表示)にする.
$('zoomLevel').addEventListener('click', () => zoomTo(1));
