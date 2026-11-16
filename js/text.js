// テキストの配置計算と描画, フォントの読み込み.

import { TEXT_INK_CENTER } from './constants.js';
import { ensureFont, fontStack } from './fonts.js';
import { isText, mapPointToCanvas } from './geometry.js';

// 文字の大きさ計測用. 描画先と同じフォントを設定して使う.
const measureCtx = document.createElement('canvas').getContext('2d');

function textFont(obj, fontSize) {
  return `${obj.weight} ${fontSize}px ${fontStack(obj.font)}`;
}

// 縁取りの太さ(描画先のpx). 文字サイズと同じく画像幅に対する比率で持つので, 文字サイズとの比で換算する.
const outlinePx = (obj, fontSize) => (obj.size > 0 ? Math.max(0, Number(obj.outlineWidth || 0)) * fontSize / obj.size : 0);

// 文字の配置と, それを囲むボックスの大きさ. ボックスは文字から自動で決まり, 縁取りの分だけ広げる.
export function textLayout(obj, fontSize) {
  measureCtx.font = textFont(obj, fontSize);
  const lines = String(obj.content).split('\n');
  const widths = lines.map((line) => measureCtx.measureText(line).width);
  const lineHeight = fontSize * 1.25;
  const outline = outlinePx(obj, fontSize);
  return {
    lines,
    lineHeight,
    outline,
    boxW: Math.max(1, ...widths) + fontSize * 0.7 + outline * 2,
    boxH: lines.length * lineHeight + fontSize * 0.35 + outline * 2,
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
  // 各行を, 行の枠(上下の余白は対称)の中央に見た目の中心が来るように置く.
  const { outline } = layout;
  const positions = layout.lines.map((line, index) => {
    const slotCenter = top + outline + fontSize * 0.175 + (index + 0.5) * layout.lineHeight;
    return [line, left + outline + fontSize * 0.35, slotCenter + fontSize * TEXT_INK_CENTER];
  });
  if (outline > 0) {
    // 縁取りは, 文字の外側に outline px 出るよう, 2倍の太さの線を文字の下に引く.
    ctx.strokeStyle = obj.outline;
    ctx.lineWidth = outline * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    positions.forEach(([line, x, y]) => ctx.strokeText(line, x, y));
  }
  ctx.fillStyle = obj.color;
  positions.forEach(([line, x, y]) => ctx.fillText(line, x, y));
  ctx.restore();
}

// 使われているフォントを先に読み込む. 未読み込みのまま描くと, 代替フォントで描かれてしまう.
// 読み込めなかった場合は, 端末内のフォントで描く.
export function loadFontsFor(list) {
  if (!document.fonts) return Promise.resolve();
  const wanted = new Map();
  list.forEach((obj) => {
    // 番号は, IBM Plex Sans JP の太字で数字を描く.
    const entry = isText(obj) ? [`${obj.weight}|${obj.font}`, obj.content]
      : obj.type === 'badge' ? ['700|plex', String(obj.number ?? '')] : null;
    if (entry) wanted.set(entry[0], `${wanted.get(entry[0]) || ''}${entry[1]}`);
  });
  return Promise.all([...wanted].map(([key, text]) => {
    const [weight, font] = key.split('|');
    // フォントの定義が登録されてから, 使う文字の分のファイルを読み込む.
    return ensureFont(font)
      .then(() => document.fonts.load(`${weight} 24px ${fontStack(font)}`, text))
      .catch((error) => console.warn(error));
  })).then(() => undefined);
}
