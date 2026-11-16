// 編集データ(プロジェクト)の保存と読み込み.

import {
  BADGE_MAX,
  MAX_OBJECTS,
  OUTLINE_MAX_PX,
  MIN_CROP,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  SHAPE_STYLES,
  SHAPE_TYPES,
  TEXT_DEFAULTS,
  TEXT_MAX_PX,
  TEXT_MIN_PX,
} from './constants.js';
import { colorOr, finite, limited } from './validate.js';
import { $, downloadBlob, setStatus } from './dom.js';
import { newObjectId, state } from './state.js';
import { FONT_KEYS, nearestWeight } from './fonts.js';
import {
  ROTATIONS, isEffectType, isLineType, refWidth,
} from './geometry.js';
import { markSaved, resetHistory, restoreSnapshot, snapshot } from './history.js';

$('saveProject').addEventListener('click', () => {
  if (!state.sourceImage) return;
  const snap = snapshot();
  const project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    source: { width: state.sourceImage.naturalWidth, height: state.sourceImage.naturalHeight, name: state.sourceName },
    document: { crop: snap.crop, objects: snap.objects, rotation: snap.rotation },
    conversion: snap.conversion,
  };
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'iMage-Editor-project.json');
  markSaved();
});

function sanitizeShape(raw) {
  if (!raw || typeof raw !== 'object' || !SHAPE_TYPES.includes(raw.type)) return null;
  let style = SHAPE_STYLES.includes(raw.style) ? raw.style : 'fill';
  if (isLineType(raw.type) && style === 'window') style = 'stroke';
  // 番号とぼかし・モザイクには, 描画方法が無い.
  if (raw.type === 'badge' || isEffectType(raw.type)) style = 'fill';
  return {
    id: newObjectId(),
    type: raw.type,
    style,
    fill: colorOr(raw.fill, '#f4c95d'),
    stroke: colorOr(raw.stroke, '#ffffff'),
    lineWidth: limited(raw.lineWidth, 0.008, 0, 1),
    opacity: limited(raw.opacity, 1, 0, 1),
    rotation: limited(raw.rotation, 0, -180, 180),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    x1: finite(raw.x1, 0), y1: finite(raw.y1, 0),
    x2: finite(raw.x2, 0), y2: finite(raw.y2, 0),
    // 種類ごとの項目. ぼかし・モザイクは強さ, 番号は数字.
    ...(isEffectType(raw.type) ? { strength: limited(raw.strength, 0.024, 0, 1) } : {}),
    ...(raw.type === 'badge' ? { number: Math.round(limited(raw.number, 1, 0, BADGE_MAX)) } : {}),
  };
}

// ref は, 読み込む画像の向きでの基準幅(文字サイズの範囲の換算に使う).
function sanitizeText(raw, ref) {
  const font = FONT_KEYS.includes(raw.font) ? raw.font : TEXT_DEFAULTS.font;
  // そのフォントに無い太さは, 最も近い太さに直す.
  const weight = nearestWeight(font, raw.weight ?? TEXT_DEFAULTS.weight);
  return {
    id: newObjectId(),
    type: 'text',
    content: typeof raw.content === 'string' ? raw.content.slice(0, 2000) : '',
    color: colorOr(raw.color, TEXT_DEFAULTS.color),
    bg: colorOr(raw.bg, TEXT_DEFAULTS.bg),
    transparent: Boolean(raw.transparent),
    outline: colorOr(raw.outline, TEXT_DEFAULTS.outline),
    outlineWidth: limited(raw.outlineWidth, 0, 0, OUTLINE_MAX_PX / ref),
    size: limited(raw.size, TEXT_DEFAULTS.sizePx / ref, TEXT_MIN_PX / ref, TEXT_MAX_PX / ref),
    font,
    weight,
    opacity: limited(raw.opacity, 1, 0, 1),
    rotation: limited(raw.rotation, 0, -180, 180),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    x: finite(raw.x, 0.5),
    y: finite(raw.y, 0.5),
  };
}

function sanitizeObject(raw, ref) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.type === 'text' ? sanitizeText(raw, ref) : sanitizeShape(raw);
}

function sanitizeDocument(raw) {
  if (!raw || typeof raw !== 'object' || !raw.crop || typeof raw.crop !== 'object') throw new Error('invalid project');
  // 図形とテキストを1つの配列で持つ形式(拡張機能版 v1.2.0 以降, Web 版)だけを読む. それより前の形式には対応しない.
  if (!Array.isArray(raw.objects)) throw new Error('invalid project');
  const rotation = ROTATIONS.includes(raw.rotation) ? raw.rotation : 0;
  const ref = refWidth(rotation);
  const list = raw.objects.slice(0, MAX_OBJECTS).map((item) => sanitizeObject(item, ref)).filter(Boolean);
  const w = limited(raw.crop.w, 1, MIN_CROP, 1);
  const h = limited(raw.crop.h, 1, MIN_CROP, 1);
  return {
    crop: {
      x: Math.min(limited(raw.crop.x, 0, 0, 1), 1 - w),
      y: Math.min(limited(raw.crop.y, 0, 0, 1), 1 - h),
      w,
      h,
    },
    objects: list,
    rotation,
  };
}

// 編集データ(.json)を読み込む. ファイルの選択と, ドロップ(open.js)から使う.
export async function loadProjectFile(projectFile) {
  try {
    const project = JSON.parse(await projectFile.text());
    if (!project || project.format !== PROJECT_FORMAT || !project.document || !project.conversion) throw new Error('invalid project');
    // 新しい版で保存されたデータは, 知らない設定を落として壊してしまうため読み込まない.
    if (finite(project.version, 1) > PROJECT_VERSION) throw new Error('newer project');
    if (!state.sourceImage) throw new Error('source image required');
    const size = project.source || {};
    if (size.width !== state.sourceImage.naturalWidth || size.height !== state.sourceImage.naturalHeight) throw new Error('source dimensions differ');

    // 失敗しても現在の編集内容を壊さないよう, 先に検証を済ませてから反映する.
    const sanitized = sanitizeDocument(project.document);
    restoreSnapshot({ ...sanitized, conversion: project.conversion });
    resetHistory();
    markSaved();
    setStatus('編集データを読み込みました');
  } catch (error) {
    setStatus(error.message === 'source image required'
      ? '先に元画像を読み込んでください'
      : error.message === 'source dimensions differ'
        ? '元画像のサイズが保存データと一致しません'
        : error.message === 'newer project'
          ? 'より新しい版のiMage Editorで保存された編集データです. ページを再読み込みしてから, もう一度読み込んでください'
          : '編集データを読み込めませんでした');
  }
}

$('loadProject').addEventListener('change', async () => {
  const projectFile = $('loadProject').files?.[0];
  $('loadProject').value = '';
  if (projectFile) await loadProjectFile(projectFile);
});
