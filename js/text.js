// テキストの配置計算と描画, フォントの読み込み.

import { FONT_STACKS, TEXT_INK_CENTER } from './constants.js';
import { isText, mapPointToCanvas } from './geometry.js';

// 文字の大きさ計測用. 描画先と同じフォントを設定して使う.
const measureCtx = document.createElement('canvas').getContext('2d');

function textFont(obj, fontSize) {
  return `${obj.weight} ${fontSize}px ${FONT_STACKS[obj.font] || FONT_STACKS.plex}`;
}

// 文字の配置と, それを囲むボックスの大きさ. ボックスは文字から自動で決まる.
export function textLayout(obj, fontSize) {
  measureCtx.font = textFont(obj, fontSize);
  const lines = String(obj.content).split('\n');
  const widths = lines.map((line) => measureCtx.measureText(line).width);
  const lineHeight = fontSize * 1.25;
  return {
    lines,
    lineHeight,
    boxW: Math.max(1, ...widths) + fontSize * 0.7,
    boxH: lines.length * lineHeight + fontSize * 0.35,
  };
}

export function drawText(ctx, width, height, obj, cropRect) {
  if (!obj.content.trim()) return;
  const fontSize = Math.max(1, obj.size * width / cropRect.w);
  const layout = textLayout(obj, fontSize);
  const center = mapPointToCanvas(obj.x, obj.y, width, height, cropRect);
  const left = -layout.boxW / 2;
  const top = -layout.boxH / 2;

  ctx.save();
  ctx.globalAlpha = obj.opacity;
  ctx.translate(center.x, center.y);
  ctx.rotate(Number(obj.rotation || 0) * Math.PI / 180);
  ctx.font = textFont(obj, fontSize);
  ctx.textBaseline = 'alphabetic';
  if (!obj.transparent) {
    ctx.fillStyle = obj.bg;
    ctx.fillRect(left, top, layout.boxW, layout.boxH);
  }
  ctx.fillStyle = obj.color;
  // 各行を, 行の枠(上下の余白は対称)の中央に見た目の中心が来るように置く.
  layout.lines.forEach((line, index) => {
    const slotCenter = top + fontSize * 0.175 + (index + 0.5) * layout.lineHeight;
    ctx.fillText(line, left + fontSize * 0.35, slotCenter + fontSize * TEXT_INK_CENTER);
  });
  ctx.restore();
}

// 使われているフォントを先に読み込む. 未読み込みのまま描くと, 代替フォントで描かれてしまう.
export function loadFontsFor(list) {
  if (!document.fonts) return Promise.resolve();
  const wanted = new Map();
  list.filter(isText).forEach((obj) => {
    const key = `${obj.weight}|${obj.font}`;
    wanted.set(key, `${wanted.get(key) || ''}${obj.content}`);
  });
  return Promise.all([...wanted].map(([key, text]) => {
    const [weight, font] = key.split('|');
    return document.fonts.load(`${weight} 24px ${FONT_STACKS[font] || FONT_STACKS.plex}`, text).catch((error) => console.warn(error));
  })).then(() => undefined);
}
