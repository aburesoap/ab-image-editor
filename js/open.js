// 画像を開く. ファイルの選択, 画面へのドラッグ&ドロップ, クリップボードからの貼り付け(Ctrl+V, 貼り付けボタン)に対応する.
// 編集データ(.json)をドロップした場合は, 編集データとして読み込む.
// 画像を開いている間は, Shift を押しながらのドロップと Ctrl+Shift+V で, 開き直さずに画像レイヤーとして重ねる.

import { FULL_CROP, IMAGE_TYPES, TOOL_BUTTONS } from './constants.js';
import { $, file, result, setDisabled, setStatus } from './dom.js';
import { makeBaseLayer, objects, state } from './state.js';
import { drawEditor } from './render.js';
import { updateLabels } from './settings.js';
import { invalidateResult } from './convert.js';
import { updateSelectionInspector } from './inspector.js';
import { hasUnsavedEdits, markSaved, resetHistory } from './history.js';
import { addImageLayers, syncShapeOptions, updateToolUI } from './actions.js';
import { zoomFit } from './stage.js';
import { loadProjectFile } from './project.js';
import { pruneImageAssets } from './image-layer.js';

// 画像を読み込んでから使えるようになるボタン.
const IMAGE_CONTROLS = [
  'convert', 'showResult', 'grayscale', 'cropReset', 'rotateLeft', 'rotateRight',
  'saveProject', 'saveProjectEmbedded', 'download', 'copyImage', 'viewEdit', 'viewResult', 'addPaper', 'addPaint', 'addImage',
];

const isImageFile = (blob) => Boolean(blob) && IMAGE_TYPES.includes(blob.type);
const isProjectFile = (blob) => Boolean(blob) && (blob.type === 'application/json' || /\.json$/i.test(blob.name || ''));

// 未保存の編集があれば, 破棄してよいかを確かめる.
function confirmDiscard() {
  return !hasUnsavedEdits() || window.confirm('編集中の内容は破棄されます. 新しい画像を開きますか？');
}

// 画像を開き, 編集の状態を初期化する. how は状態表示に使う(「読み込み」「貼り付け」など).
// 開けたら true, 開かなかった(形式が違う, 破棄を断った, 読み込めなかった)ら false で解決する.
export function openImage(blob, name, how = '読み込み') {
  if (!isImageFile(blob)) {
    setStatus('この形式の画像は開けません. PNG / JPEG / WebP / GIF / BMP / AVIF を選んでください');
    return Promise.resolve(false);
  }
  if (!confirmDiscard()) return Promise.resolve(false);
  const objectURL = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve) => {
  image.onload = () => {
    if (state.sourceURL) URL.revokeObjectURL(state.sourceURL);
    state.sourceURL = objectURL;
    state.sourceName = name;
    state.sourceImage = image;
    // 編集データへ元画像を埋め込むときのため, ファイルそのものを持っておく.
    state.sourceBlob = blob;
    state.crop = { ...FULL_CROP };
    state.rotation = 0;
    state.zoom.fit = true;
    objects.length = 0;
    objects.push(makeBaseLayer());
    // 前の画像に重ねていた画像の素材は, もう使わない.
    pruneImageAssets();
    state.tool = 'select';
    state.view = 'edit';
    state.selectedIndex = -1;
    state.currentShape = null;
    state.pointerAction = null;

    setDisabled(IMAGE_CONTROLS, false);
    setDisabled(Object.keys(TOOL_BUTTONS), false);
    syncShapeOptions();
    updateToolUI();
    updateSelectionInspector();
    updateLabels();
    result.width = 1;
    result.height = 1;
    invalidateResult();
    drawEditor();
    zoomFit();
    resetHistory();
    markSaved();
    setStatus(`${how}完了：${image.naturalWidth} × ${image.naturalHeight} px`);
    resolve(true);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectURL);
    setStatus('画像を読み込めませんでした. 別の画像を選んでください');
    resolve(false);
  };
  image.src = objectURL;
  });
}

// ---- ファイルの選択 ----
file.addEventListener('change', () => {
  const selected = file.files && file.files[0];
  // 同じファイルをもう一度選んでもchangeが発火するよう, 選択状態を空に戻す.
  file.value = '';
  if (selected) openImage(selected, selected.name);
});

// ---- ドラッグ&ドロップ ----
// 子要素の間を移動するたびに dragenter / dragleave が届くため, 数を数えて画面全体の出入りを判定する.
let dragDepth = 0;
const carriesFiles = (event) => Boolean(event.dataTransfer) && [...event.dataTransfer.types].includes('Files');
const showDropOverlay = (show) => { $('dropOverlay').hidden = !show; };

window.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  showDropOverlay(true);
});
window.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) showDropOverlay(false);
});
window.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  showDropOverlay(false);
  const files = [...event.dataTransfer.files];
  const image = files.find(isImageFile);
  const project = files.find(isProjectFile);
  if (image && event.shiftKey && state.sourceImage) addImageLayers(files.filter(isImageFile));
  else if (image) openImage(image, image.name);
  else if (project) loadProjectFile(project, openImage);
  else setStatus('ドロップしたファイルは開けません. 画像（PNG / JPEG / WebP / GIF / BMP / AVIF）か, 編集データ（.json）を選んでください');
});

// ---- 貼り付け ----
// Ctrl+Shift+V は, ブラウザが貼り付けとして届けないため, キーを受けてクリップボードを直接読み, 画像を重ねる.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || String(event.key).toLowerCase() !== 'v') return;
  if (!state.sourceImage || isTextTarget(event.target)) return;
  event.preventDefault();
  pasteFromClipboard(true);
});

// 文字を入力する欄か. 入力欄への貼り付けは, そのまま文字として扱う.
function isTextTarget(target) {
  const tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
  return tag === 'TEXTAREA' || (tag === 'INPUT' && ['text', 'number', 'search'].includes(target.type)) || Boolean(target?.isContentEditable);
}
document.addEventListener('paste', (event) => {
  if (isTextTarget(event.target)) return;
  const items = [...(event.clipboardData?.items || [])];
  const item = items.find((entry) => entry.kind === 'file' && IMAGE_TYPES.includes(entry.type));
  if (!item) {
    if (items.some((entry) => entry.kind === 'file')) setStatus('貼り付けたファイルは, 画像として開けません');
    return;
  }
  event.preventDefault();
  openImage(item.getAsFile(), '貼り付けた画像', '貼り付け');
});

// ---- 貼り付けボタン ----
// キーボードの無いスマホやタブレットでも貼り付けられるよう, クリップボードを読み取って開く.
// ブラウザによっては, 読み取ってよいかの確認や「ペースト」の表示が出る. asLayer なら, 開き直さずに重ねる.
export async function pasteFromClipboard(asLayer = false) {
  if (!navigator.clipboard?.read) {
    setStatus('このブラウザでは, ボタンからの貼り付けに対応していません. Ctrl+V で貼り付けてください');
    return;
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (error) {
    setStatus(error?.name === 'NotAllowedError'
      ? 'クリップボードの読み取りが許可されませんでした. ブラウザの設定を確かめてください'
      : 'クリップボードを読み取れませんでした');
    return;
  }
  for (const item of items) {
    const type = item.types.find((entry) => IMAGE_TYPES.includes(entry));
    if (!type) continue;
    const blob = await item.getType(type);
    // 読み取った画像に種類が付いていないブラウザがあるため, 種類を付け直す.
    const image = blob.type ? blob : new Blob([blob], { type });
    if (asLayer) addImageLayers([image]);
    else openImage(image, '貼り付けた画像', '貼り付け');
    return;
  }
  setStatus('クリップボードに画像がありません. 画像をコピーしてから押してください');
}

$('pasteImage').addEventListener('click', () => pasteFromClipboard());

// ---- 編集データの読み込み ----
$('loadProject').addEventListener('change', async () => {
  const projectFile = $('loadProject').files?.[0];
  $('loadProject').value = '';
  if (projectFile) await loadProjectFile(projectFile, openImage);
});
