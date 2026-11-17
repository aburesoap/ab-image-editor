// 編集データ(プロジェクト)の保存と読み込み.

import {
  BADGE_MAX,
  EMBED_MAX_BYTES,
  IMAGE_TYPES,
  PAINT_MAX_STROKES,
  PEN_MAX_POINTS,
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
import { makeBaseLayer, newObjectId, state } from './state.js';
import { FONT_KEYS, nearestWeight } from './fonts.js';
import {
  ROTATIONS, canCutout, isEffectType, isLineType, isPenType, refWidth,
} from './geometry.js';
import { markSaved, resetHistory, restoreSnapshot, snapshot } from './history.js';
import { imageAsset, pruneImageAssets, registerImageAsset } from './image-layer.js';

// 重ねた画像の素材の数の上限.
const MAX_IMAGE_ASSETS = 100;

// ファイルの中身を, base64 の文字列にする(先頭の「data:…;base64,」は除く).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// 編集データを保存する. embed が true なら, 元画像のファイルも中に入れ, 1つのファイルだけで開けるようにする.
// 今の編集内容を, 編集データの形にする(画像のデータは含めない). 自動保存(autosave.js)からも使う.
export function projectData() {
  const snap = snapshot();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    source: { width: state.sourceImage.naturalWidth, height: state.sourceImage.naturalHeight, name: state.sourceName },
    document: { crop: snap.crop, objects: snap.objects, rotation: snap.rotation },
    conversion: snap.conversion,
  };
}

// 編集データで使っている, 重ねた画像の素材の番号.
export const usedImageIds = (project) => [...new Set(project.document.objects
  .filter((obj) => obj.type === 'image').map((obj) => obj.imageId))].filter(imageAsset);

async function saveProject(embed) {
  if (!state.sourceImage) return;
  const project = projectData();
  // 重ねた画像は, 元画像を含めない保存でも必ず中に入れる(ほかに取り戻す手段が無いため).
  const ids = usedImageIds(project);
  if (ids.length) {
    project.images = await Promise.all(ids.map(async (id) => {
      const asset = imageAsset(id);
      return { id, type: asset.blob.type, name: asset.name, data: await blobToBase64(asset.blob) };
    }));
  }
  if (embed) {
    const blob = state.sourceBlob;
    if (!blob || !IMAGE_TYPES.includes(blob.type) || blob.size > EMBED_MAX_BYTES) {
      setStatus('元画像が大きすぎるか, 形式に対応していないため, 埋め込めません. 「元画像を含めずに保存」をお使いください');
      return;
    }
    project.image = { type: blob.type, data: await blobToBase64(blob) };
  }
  downloadBlob(new Blob([JSON.stringify(project, null, embed ? 0 : 2)], { type: 'application/json' }), 'iMage-Editor-project.json');
  markSaved();
  setStatus(embed ? '編集データを保存しました（元画像を含む）' : '編集データを保存しました（元画像を含まない）');
}

$('saveProjectEmbedded').addEventListener('click', () => saveProject(true));
$('saveProject').addEventListener('click', () => saveProject(false));

// 画像レイヤー. 素材が読み込めなかったもの(assetIds に無い番号)は落とす.
function sanitizeImage(raw, assetIds) {
  const imageId = assetIds.get(raw.imageId);
  if (!imageId) return null;
  return {
    id: newObjectId(),
    type: 'image',
    imageId,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : '',
    style: 'fill',
    fill: '#ffffff',
    stroke: '#ffffff',
    lineWidth: 0,
    opacity: limited(raw.opacity, 1, 0, 1),
    rotation: limited(raw.rotation, 0, -180, 180),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    ...(raw.cutout === true ? { cutout: true } : {}),
    x1: finite(raw.x1, 0.25), y1: finite(raw.y1, 0.25),
    x2: finite(raw.x2, 0.75), y2: finite(raw.y2, 0.75),
  };
}

function sanitizeShape(raw) {
  if (!raw || typeof raw !== 'object' || !SHAPE_TYPES.includes(raw.type)) return null;
  let style = SHAPE_STYLES.includes(raw.style) ? raw.style : 'fill';
  if (isLineType(raw.type) && style === 'window') style = 'stroke';
  // 番号とぼかし・モザイクには, 描画方法が無い.
  if (raw.type === 'badge' || isEffectType(raw.type) || raw.type === 'paper' || raw.type === 'paint') style = 'fill';
  const shape = {
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
  if (raw.cutout === true && canCutout(raw.type)) shape.cutout = true;
  if (isPenType(raw.type)) {
    // ペン・蛍光ペンの点は, 枠の中の位置(0〜1)の組. 形が崩れていれば, その線は読み込まない.
    const points = Array.isArray(raw.points) ? raw.points.slice(0, PEN_MAX_POINTS * 2) : [];
    if (points.length < 2 || points.length % 2 || !points.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    shape.points = points.map((v) => Math.max(0, Math.min(1, v)));
    shape.style = 'stroke';
  }
  if (raw.type === 'paper' || raw.type === 'paint') {
    // 白地・ペイントは, 画像全体に固定する.
    Object.assign(shape, { x1: 0, y1: 0, x2: 1, y2: 1, rotation: 0 });
  }
  if (raw.type === 'paint') {
    // 線の形が崩れているものだけを落とし, 残りは読み込む.
    const strokes = Array.isArray(raw.strokes) ? raw.strokes.slice(0, PAINT_MAX_STROKES) : [];
    shape.strokes = strokes.map(sanitizeStroke).filter(Boolean);
  }
  return shape;
}

const STROKE_TOOLS = ['pen', 'marker', 'eraser'];

function sanitizeStroke(raw) {
  if (!raw || typeof raw !== 'object' || !STROKE_TOOLS.includes(raw.tool)) return null;
  const points = Array.isArray(raw.points) ? raw.points.slice(0, PEN_MAX_POINTS * 2) : [];
  if (points.length < 2 || points.length % 2 || !points.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    tool: raw.tool,
    color: colorOr(raw.color, '#000000'),
    width: limited(raw.width, 0.01, 0, 1),
    opacity: limited(raw.opacity, 1, 0, 1),
    points: points.map((v) => Math.max(0, Math.min(1, v))),
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
    ...(raw.cutout === true ? { cutout: true } : {}),
    x: finite(raw.x, 0.5),
    y: finite(raw.y, 0.5),
  };
}

function sanitizeObject(raw, ref, assetIds) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'image') return sanitizeImage(raw, assetIds);
  if (raw.type === 'base') {
    return {
      ...makeBaseLayer(),
      opacity: limited(raw.opacity, 1, 0, 1),
      hidden: raw.hidden === true,
      locked: raw.locked === true,
    };
  }
  return raw.type === 'text' ? sanitizeText(raw, ref) : sanitizeShape(raw);
}

function sanitizeDocument(raw, assetIds) {
  if (!raw || typeof raw !== 'object' || !raw.crop || typeof raw.crop !== 'object') throw new Error('invalid project');
  // 図形とテキストを1つの配列で持つ形式(拡張機能版 v1.2.0 以降, Web 版)だけを読む. それより前の形式には対応しない.
  if (!Array.isArray(raw.objects)) throw new Error('invalid project');
  const rotation = ROTATIONS.includes(raw.rotation) ? raw.rotation : 0;
  const ref = refWidth(rotation);
  let list = raw.objects.slice(0, MAX_OBJECTS).map((item) => sanitizeObject(item, ref, assetIds)).filter(Boolean);
  // 元画像のレイヤーは1つだけ. 無ければ(v10 までの編集データ), いちばん下に置く.
  const firstBase = list.find((obj) => obj.type === 'base');
  list = list.filter((obj) => obj.type !== 'base' || obj === firstBase);
  if (!firstBase) list.unshift(makeBaseLayer());
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

// 読み込みに失敗したときの案内.
export function projectErrorMessage(error) {
  if (error.message === 'source image required') return '先に元画像を読み込んでください（元画像を含めて保存した編集データなら, そのまま開けます）';
  if (error.message === 'source dimensions differ') return '元画像のサイズが保存データと一致しません';
  if (error.message === 'newer project') return 'より新しい版のiMage Editorで保存された編集データです. ページを再読み込みしてから, もう一度読み込んでください';
  return '編集データを読み込めませんでした';
}

// 編集データの形と版を確かめる. 新しい版で保存されたデータは, 知らない設定を落として壊してしまうため読み込まない.
export function checkProject(project) {
  if (!project || project.format !== PROJECT_FORMAT || !project.document || !project.conversion) throw new Error('invalid project');
  if (finite(project.version, 1) > PROJECT_VERSION) throw new Error('newer project');
}

// 編集データの中身を, 今開いている元画像に反映する. 履歴は作り直す.
// assets は重ねた画像の素材 [{ id(保存時の番号), blob, name }]. 失敗したら例外を投げ, 今の編集内容は変えない.
export async function applyProjectData(project, assets = []) {
  if (!state.sourceImage) throw new Error('source image required');
  const size = project.source || {};
  if (size.width !== state.sourceImage.naturalWidth || size.height !== state.sourceImage.naturalHeight) throw new Error('source dimensions differ');

  // 重ねた画像の素材を読み込む. 保存時の番号から, 今回付けた番号への対応を作る.
  const assetIds = new Map();
  for (const entry of assets.slice(0, MAX_IMAGE_ASSETS)) {
    if (!entry || typeof entry.id !== 'string' || !(entry.blob instanceof Blob)) continue;
    const id = await registerImageAsset(entry.blob, typeof entry.name === 'string' ? entry.name : '');
    if (id) assetIds.set(entry.id, id);
  }

  // 失敗しても現在の編集内容を壊さないよう, 先に検証を済ませてから反映する.
  const sanitized = sanitizeDocument(project.document, assetIds);
  restoreSnapshot({ ...sanitized, conversion: project.conversion });
  // 読み込んだ編集データで使っていない素材(前に重ねていた画像など)は捨てる. 履歴も作り直すので, 戻ることは無い.
  pruneImageAssets(sanitized.objects.filter((obj) => obj.type === 'image').map((obj) => obj.imageId));
  resetHistory();
}

// 編集データ(.json)を読み込む. ファイルの選択と, ドロップから使う(どちらも open.js).
// 元画像が埋め込まれていれば, openImage(blob, name) でその画像を開いてから反映する.
// openImage は open.js から渡してもらう(このモジュールが open.js を読み込むと, 循環してしまうため).
export async function loadProjectFile(projectFile, openImage) {
  try {
    const project = JSON.parse(await projectFile.text());
    checkProject(project);
    if (project.image) {
      const { type, data } = project.image;
      if (!IMAGE_TYPES.includes(type) || typeof data !== 'string' || data.length > EMBED_MAX_BYTES * 1.4) throw new Error('invalid project');
      const name = typeof project.source?.name === 'string' ? project.source.name.slice(0, 200) : '編集データの画像';
      // 開くのをやめた(未保存の編集の破棄を断った)場合は, 何も変えない.
      if (!(await openImage(base64ToBlob(data, type), name))) return;
    }
    // 重ねた画像は, base64 の文字列からファイルに戻しておく.
    const images = Array.isArray(project.images) ? project.images.slice(0, MAX_IMAGE_ASSETS) : [];
    const assets = images
      .filter((entry) => entry && typeof entry.id === 'string' && IMAGE_TYPES.includes(entry.type)
        && typeof entry.data === 'string' && entry.data.length <= EMBED_MAX_BYTES * 1.4)
      .map((entry) => ({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : '', blob: base64ToBlob(entry.data, entry.type) }));
    await applyProjectData(project, assets);
    markSaved();
    setStatus('編集データを読み込みました');
  } catch (error) {
    setStatus(projectErrorMessage(error));
  }
}
