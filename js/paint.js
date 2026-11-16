// ペイントレイヤーの描画. 画像全体に広がる透明なレイヤーで, 上に描いた線を strokes にまとめて持つ.
// 線1本は { tool: 'pen' | 'marker' | 'eraser', color, width, opacity, points: [x, y, x, y, ...] }.
// points は画像上の位置(0〜1), width は画像幅に対する比率.
//
// レイヤーは, 別のcanvasに描いてから重ねる. 消しゴムはそのcanvasの中を消すだけなので, 下の画像やレイヤーは消えない.
// 蛍光ペンは下の色と掛け合わせて(乗算)重ねたいので, ペンとは別のcanvasに描き, 先に乗算で重ねてから, ペンを上に重ねる.
// (そのため, 1つのレイヤーの中では, ペンの線が常に蛍光ペンより上に見える.)

import { mapPointToCanvas } from './geometry.js';
import { strokeList } from './pen.js';

// 描き重ね用のcanvas. 描くたびに作ると重いので, プレビューの大きさまでは使い回す(大きさが変わったときだけ作り直す).
// それより大きい書き出しでは, その場で作って, 使い終わったらすぐにメモリを返す.
const scratch = { pen: null, marker: null };
const CACHE_LIMIT = 4096 * 4096;

function layerCanvas(key, width, height) {
  const temp = width * height > CACHE_LIMIT;
  let canvas = temp ? null : scratch[key];
  if (!canvas) {
    canvas = document.createElement('canvas');
    if (!temp) scratch[key] = canvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  return { canvas, ctx, temp };
}

function release(layer) {
  if (layer && layer.temp) {
    layer.canvas.width = 0;
    layer.canvas.height = 0;
  }
}

function strokePoints(stroke, width, height, cropRect) {
  const list = [];
  const points = stroke.points || [];
  for (let i = 0; i + 1 < points.length; i += 2) list.push(mapPointToCanvas(points[i], points[i + 1], width, height, cropRect));
  return list;
}

// 1本を, 指定のcanvasへ描く. 消しゴムは, 描いた形の分だけ透明にする.
function paintStroke(ctx, stroke, width, height, cropRect) {
  const lineWidth = Math.max(1, Number(stroke.width || 0) * width / cropRect.w);
  ctx.save();
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
  } else {
    ctx.globalAlpha = Number(stroke.opacity ?? 1);
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }
  strokeList(ctx, strokePoints(stroke, width, height, cropRect), lineWidth, stroke.tool);
  ctx.restore();
}

// ペイントレイヤーを ctx へ重ねる. extra は描いている途中の線(無ければ null).
export function drawPaint(ctx, width, height, layer, cropRect, extra = null) {
  const strokes = extra ? [...(layer.strokes || []), extra] : layer.strokes || [];
  if (!strokes.length) return;
  const usesMarker = strokes.some((s) => s.tool === 'marker');
  const pen = layerCanvas('pen', width, height);
  const marker = usesMarker ? layerCanvas('marker', width, height) : null;
  strokes.forEach((stroke) => {
    if (stroke.tool === 'eraser') {
      // 消しゴムは, その時点までに描いた線(ペンも蛍光ペンも)を消す.
      paintStroke(pen.ctx, stroke, width, height, cropRect);
      if (marker) paintStroke(marker.ctx, stroke, width, height, cropRect);
    } else {
      paintStroke(stroke.tool === 'marker' && marker ? marker.ctx : pen.ctx, stroke, width, height, cropRect);
    }
  });
  ctx.save();
  ctx.globalAlpha = Number(layer.opacity ?? 1);
  if (marker) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(marker.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(pen.canvas, 0, 0);
  ctx.restore();
  release(pen);
  release(marker);
}
