// 定数. 各モジュールから共通で使う設定値や, 画面要素のid一覧.

// canvas描画用のフォント. studio.css の --font-sans と揃える.
export const FONT_STACKS = {
  plex: '"IBM Plex Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif',
  udev: '"UDEV Gothic", ui-monospace, "SFMono-Regular", Consolas, "Noto Sans Mono CJK JP", monospace',
};
export const FONT_KEYS = Object.keys(FONT_STACKS);
export const FONT_WEIGHTS = [400, 600, 700];
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const MIN_CROP = 0.03;
export const HISTORY_LIMIT = 80;
export const MAX_OBJECTS = 500;
export const PROJECT_FORMAT = 'iMage-Editor-project';
export const PROJECT_VERSION = 4;
export const SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];
export const SHAPE_STYLES = ['fill', 'stroke', 'window'];
export const DITHER_METHODS = ['floyd', 'atkinson', 'ordered', 'none'];
// 開ける画像の形式. ファイルの選択(index.html の accept)と揃える.
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
// プレビューの描画解像度の上限(長辺). 通常は元画像と同じ解像度で描き, 極端に大きい画像だけ縮小する.
const PREVIEW_LIMIT = 4096;
// メモリが少ない端末や, タッチ操作が中心の端末で使う上限. 画面の幅より十分に大きいので, 見た目はほぼ変わらない.
const PREVIEW_LIMIT_LIGHT = 2048;
// 文字サイズ・線幅の「px」は, 長辺がこの値の画像に換算した大きさを表す. 画像の解像度が違っても見た目の比率は変わらない.
export const UI_REFERENCE_SIDE = 500;
// ハンドルの大きさ(画面上のpx). canvasの縮小表示に合わせて, 描画時に換算する.
export const HANDLE_RADIUS = 5;
export const HANDLE_REACH = 11;
export const HANDLE_REACH_TOUCH = 24;
export const ROTATE_OFFSET = 26;
export const MIN_SHAPE_SIDE = 4;
// 文字サイズの範囲(UI上のpx). 編集パネルのスライダーの範囲と揃える.
export const TEXT_MIN_PX = 8;
export const TEXT_MAX_PX = 200;
// 文字の見た目の中心が, ベースラインより何em上にあるか. 同梱フォントの「あ」「日」「H」の実測値(0.36〜0.39)に合わせている.
export const TEXT_INK_CENTER = 0.37;
export const TEXT_DEFAULTS = {
  content: 'テキスト', color: '#ffffff', bg: '#202020', transparent: false, sizePx: 24, font: 'plex', weight: 600,
};
export const DEFAULT_EXPORT_NAME = 'Edited iMage';
export const EXPORT_FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG 画像', lossy: false, note: 'PNGは劣化なしで保存でき, 透過も保てます' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG 画像', lossy: true, note: 'JPEGは透過に対応しないため, 透明な部分は白で塗りつぶされます' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP 画像', lossy: true, note: 'WebPは小さなファイルサイズで保存でき, 透過にも対応します' },
};

export const previewSide = (() => {
  const lowMemory = typeof navigator !== 'undefined' && Boolean(navigator.deviceMemory) && navigator.deviceMemory <= 4;
  const touchFirst = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return lowMemory || touchFirst ? PREVIEW_LIMIT_LIGHT : PREVIEW_LIMIT;
})();

export const defaults = {
  maxSide: 500,
  colors: 16,
  brightness: 0,
  contrast: 100,
  method: 'floyd',
  // 減色・ディザリングは詳細設定の一機能. 既定では行わない.
  quantizeEnabled: false,
  keepOriginalResolution: true,
};

// 値の表示ラベルを更新する対象のスライダー.
export const sliders = ['maxSide', 'colors', 'brightness', 'contrast'];

// 道具のボタン(id)と道具の名前, 道具ごとの操作の案内, ショートカットキー.
export const TOOL_BUTTONS = {
  toolSelect: 'select', toolCrop: 'crop', toolShape: 'shape', toolText: 'text',
};
export const TOOL_HINTS = {
  select: 'クリックで選択／ドラッグで移動／ハンドルでサイズ変更・回転',
  crop: '枠をドラッグして切り抜き範囲を調整／上のボタンで画像を90°回転',
  shape: 'ドラッグして図形を配置',
  text: 'クリックしてテキストを配置',
};
export const TOOL_KEYS = { v: 'select', c: 'crop', r: 'shape', t: 'text' };
// 新しく置く図形の最初の設定. 以降は, 直前に編集した値を引き継ぐ.
export const SHAPE_DEFAULTS = {
  fill: '#f4c95d', stroke: '#ffffff', lineWidthPx: 4, opacity: 1,
};
export const inspectorFields = [
  'editX', 'editY', 'editAngle', 'editOpacity',
  'editWidth', 'editHeight', 'editFill', 'editStroke', 'editStyle', 'editLineWidth',
  'editTextContent', 'editTextColor', 'editTextBg', 'editTextTransparent', 'editTextSize', 'editTextFont', 'editTextWeight',
];
// ロック中は動かせないため, 位置・大きさ・角度の欄を無効にする.
export const geometryFields = ['editX', 'editY', 'editWidth', 'editHeight', 'editAngle'];
export const colorFields = ['editTextColor', 'editTextBg', 'editFill', 'editStroke'];
export const orderButtons = ['bringFront', 'sendBack'];
export const inspectorControls = [
  ...inspectorFields, ...orderButtons, 'duplicateObject', 'deleteObject',
];
