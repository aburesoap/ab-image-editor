// 編集データ(プロジェクト)の保存と読み込み.

import {
  FONT_KEYS,
  FONT_WEIGHTS,
  MAX_OBJECTS,
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
import { ROTATIONS, isLineType, refWidth } from './geometry.js';
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
  };
}

// ref は, 読み込む画像の向きでの基準幅(文字サイズの範囲の換算に使う).
function sanitizeText(raw, ref) {
  const font = FONT_KEYS.includes(raw.font) ? raw.font : TEXT_DEFAULTS.font;
  const weight = FONT_WEIGHTS.includes(Number(raw.weight)) ? Number(raw.weight) : TEXT_DEFAULTS.weight;
  return {
    id: newObjectId(),
    type: 'text',
    content: typeof raw.content === 'string' ? raw.content.slice(0, 2000) : '',
    color: colorOr(raw.color, TEXT_DEFAULTS.color),
    bg: colorOr(raw.bg, TEXT_DEFAULTS.bg),
    transparent: Boolean(raw.transparent),
    size: limited(raw.size, TEXT_DEFAULTS.sizePx / ref, TEXT_MIN_PX / ref, TEXT_MAX_PX / ref),
    font,
    weight: font === 'udev' ? 400 : weight,
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

// v1.1.x以前の編集データは, 文字が1つだけ別枠で保存されている. 内容があれば1つのテキストへ変換する.
function migrateLegacyText(raw, ref) {
  if (!raw || typeof raw !== 'object' || typeof raw.content !== 'string' || !raw.content.trim()) return null;
  return sanitizeText({
    type: 'text',
    content: raw.content,
    color: raw.color,
    bg: raw.bg,
    transparent: raw.transparent,
    size: limited(raw.size, TEXT_DEFAULTS.sizePx, TEXT_MIN_PX, TEXT_MAX_PX) / ref,
    x: limited(raw.x, 50, 0, 100) / 100,
    y: limited(raw.y, 80, 0, 100) / 100,
  }, ref);
}

function sanitizeDocument(raw) {
  if (!raw || typeof raw !== 'object' || !raw.crop || typeof raw.crop !== 'object') throw new Error('invalid project');
  // v1.4.1以前のデータには向きが無いため, 回転なしとして扱う.
  const rotation = ROTATIONS.includes(raw.rotation) ? raw.rotation : 0;
  const ref = refWidth(rotation);
  let list;
  if (Array.isArray(raw.objects)) {
    list = raw.objects.slice(0, MAX_OBJECTS).map((item) => sanitizeObject(item, ref)).filter(Boolean);
  } else if (Array.isArray(raw.shapes)) {
    list = raw.shapes.slice(0, MAX_OBJECTS).map(sanitizeShape).filter(Boolean);
    const legacyText = migrateLegacyText(raw.text, ref);
    if (legacyText) list.push(legacyText);
  } else {
    throw new Error('invalid project');
  }
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
