// ステージ(中央の作業領域)の表示. キャンバスの表示の大きさと位置(拡大・移動), 編集/仕上がりの表示の切り替え.
import { $, original, result } from './dom.js';
import { state } from './state.js';
import { sourceSize } from './geometry.js';

// ステージの余白(px)と, 全体表示で小さい画像を拡大するときの上限の倍率.
const STAGE_MARGIN = 24;
const MAX_UPSCALE = 4;
// 拡大率の範囲と, ボタンやショートカットで切り替える段階(元画像1pxあたりの表示px).
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;
const ZOOM_STEPS = [0.05, 0.1, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
// 拡大して作業領域からはみ出しているとき, 画像の端の外側まで動かせる幅(px).
const PAN_MARGIN = 48;
// この倍率以上では, 画素の境目をぼかさずに表示する.
const PIXELATED_FROM = 3;

function available() {
  const box = $('stageCanvas');
  return { w: box.clientWidth - STAGE_MARGIN, h: box.clientHeight - STAGE_MARGIN };
}

const fitScale = (canvas, avail) => Math.min(avail.w / canvas.width, avail.h / canvas.height, MAX_UPSCALE);

// キャンバス1pxが, 元画像の何pxにあたるか. 大きな画像はプレビューを縮小して描くため, 1以上になる.
const imagePxPerCanvasPx = () => sourceSize().w / original.width;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 現在の拡大率(元画像1pxあたりの表示px).
export function zoomLevel() {
  if (!state.sourceImage || !original.width) return 1;
  return state.zoom.scale / imagePxPerCanvasPx();
}

function sizeCanvas(canvas, scale) {
  canvas.style.width = `${Math.max(1, Math.round(canvas.width * scale))}px`;
  canvas.style.height = `${Math.max(1, Math.round(canvas.height * scale))}px`;
}

function updateZoomUI() {
  const usable = Boolean(state.sourceImage) && state.view === 'edit';
  $('zoomControls').hidden = !usable;
  if (!usable) return;
  const level = zoomLevel();
  $('zoomLevel').textContent = `${Math.round(level * 100)}%`;
  $('zoomOut').disabled = level <= ZOOM_MIN + 1e-6;
  $('zoomIn').disabled = level >= ZOOM_MAX - 1e-6;
  $('zoomFit').classList.toggle('active', state.zoom.fit);
  $('zoomFit').setAttribute('aria-pressed', String(state.zoom.fit));
}

// キャンバスを, 拡大率と位置に合わせて表示する. 描画の解像度は変えない.
// 仕上がりは常に全体を表示し, 編集表示だけを拡大・移動できる.
export function fitCanvases() {
  const avail = available();
  if (!(avail.w > 0 && avail.h > 0)) return;
  if (result.width && result.height) sizeCanvas(result, fitScale(result, avail));
  if (original.width && original.height) {
    const zoom = state.zoom;
    if (zoom.fit) {
      zoom.scale = fitScale(original, avail);
      zoom.panX = 0;
      zoom.panY = 0;
    }
    const shownW = original.width * zoom.scale;
    const shownH = original.height * zoom.scale;
    // はみ出していない向きには動かさない. はみ出している向きは, 端から少し先まで動かせる.
    const limitX = shownW > avail.w ? (shownW - avail.w) / 2 + PAN_MARGIN : 0;
    const limitY = shownH > avail.h ? (shownH - avail.h) / 2 + PAN_MARGIN : 0;
    zoom.panX = clamp(zoom.panX, -limitX, limitX);
    zoom.panY = clamp(zoom.panY, -limitY, limitY);
    sizeCanvas(original, zoom.scale);
    original.style.transform = zoom.panX || zoom.panY ? `translate(${zoom.panX}px, ${zoom.panY}px)` : '';
    original.style.imageRendering = state.sourceImage && zoomLevel() >= PIXELATED_FROM ? 'pixelated' : '';
    $('stageCanvas').classList.toggle('zoomed', !zoom.fit);
  }
  updateZoomUI();
}

// 拡大率を変える. 画面上の点 from にあった画像上の点が, 変更後に点 to へ来るように位置を決める.
// start は操作開始時点の拡大率と位置(2本指の操作で, 開始時点を基準に計算するため).
export function zoomFrom(start, level, from, to = from) {
  if (!state.sourceImage || !original.width) return;
  const zoom = state.zoom;
  const fitLevel = fitScale(original, available()) / imagePxPerCanvasPx();
  const nextLevel = clamp(level, Math.min(ZOOM_MIN, fitLevel), ZOOM_MAX);
  const nextScale = nextLevel * imagePxPerCanvasPx();
  const rect = $('stageCanvas').getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const ratio = nextScale / start.scale;
  zoom.panX = to.x - cx - (from.x - cx - start.panX) * ratio;
  zoom.panY = to.y - cy - (from.y - cy - start.panY) * ratio;
  zoom.scale = nextScale;
  zoom.fit = false;
  fitCanvases();
}

export const zoomState = () => ({ scale: state.zoom.scale, panX: state.zoom.panX, panY: state.zoom.panY });

// 拡大率を指定する. 点を省略した場合は, 作業領域の中央を基準にする.
export function zoomTo(level, point) {
  const rect = $('stageCanvas').getBoundingClientRect();
  const at = point || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  zoomFrom(zoomState(), level, at);
}

export function zoomBy(factor, point) {
  zoomTo(zoomLevel() * factor, point);
}

// 段階を1つ上げる(dir=1)・下げる(dir=-1).
export function zoomStep(dir) {
  const level = zoomLevel();
  const next = dir > 0
    ? ZOOM_STEPS.find((step) => step > level * 1.001)
    : [...ZOOM_STEPS].reverse().find((step) => step < level * 0.999);
  zoomTo(next ?? (dir > 0 ? ZOOM_MAX : ZOOM_MIN));
}

// 作業領域に収まる大きさ(全体表示)に戻す.
export function zoomFit() {
  state.zoom.fit = true;
  fitCanvases();
}

// 表示位置を動かす(表示px). 全体表示のときは動かさない.
export function panBy(dx, dy) {
  if (state.zoom.fit) return;
  state.zoom.panX += dx;
  state.zoom.panY += dy;
  fitCanvases();
}

// 画像の読み込み状況と, 編集/仕上がりの表示に合わせて, 表示するキャンバスと案内を決める.
export function updateStageView() {
  const loaded = Boolean(state.sourceImage);
  const resultView = state.view === 'result';
  $('emptyState').hidden = loaded;
  original.hidden = !loaded || resultView;
  result.hidden = !(loaded && resultView && state.converted);
  $('resultEmpty').hidden = !(loaded && resultView && !state.converted);
  $('viewEdit').classList.toggle('active', !resultView);
  $('viewResult').classList.toggle('active', resultView);
  fitCanvases();
}

// ステージの大きさが変わったとき(ウィンドウの変形, パネルの開閉など)に, 表示の大きさを合わせ直す.
export function observeStage() {
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitCanvases).observe($('stageCanvas'));
  window.addEventListener('resize', fitCanvases);
}
