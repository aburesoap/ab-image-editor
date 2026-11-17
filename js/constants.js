// 定数. 各モジュールから共通で使う設定値や, 画面要素のid一覧.

export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const MIN_CROP = 0.03;
export const HISTORY_LIMIT = 80;
export const MAX_OBJECTS = 500;
export const PROJECT_FORMAT = 'iMage-Editor-project';
// 編集データの形式の版. v5 で図形の種類が増えた(角丸長方形・ひし形・星・吹き出し・太矢印・両矢印).
// v6 で, ぼかし・モザイク(strength), 番号(number), テキストの縁取り(outline, outlineWidth)が増えた.
// v7 で, ペン・蛍光ペン(points), 白地(paper), 元画像の埋め込み(image)が増えた.
// v8 で, ペイントレイヤー(paint. 線の列 strokes を持つ)が増えた.
// v9 で, くり抜き(cutout)が増えた.
// v10 で, 画像レイヤー(image. 素材の番号 imageId)と, 重ねた画像の素材(images)が増えた.
export const PROJECT_VERSION = 10;
export const SHAPE_TYPES = [
  'rect', 'roundrect', 'ellipse', 'triangle', 'diamond', 'star', 'balloon', 'blockarrow', 'badge', 'line', 'arrow', 'arrow2',
  'blur', 'mosaic', 'pen', 'marker', 'paper', 'paint',
];
// ペイントレイヤー1つに描ける線の数の上限.
export const PAINT_MAX_STROKES = 3000;
// ペン・蛍光ペンの1本あたりの点の数の上限. 超えた分は描き足さない.
export const PEN_MAX_POINTS = 4000;
// ペン・蛍光ペンの最初の設定. 以降は, 種類ごとに直前に使った値を引き継ぐ.
// 蛍光ペンは, 下の色と掛け合わせて(乗算)描くため, 下の文字が黒いまま透けて見える.
export const PEN_DEFAULTS = {
  pen: { stroke: '#d83b3b', widthPx: 4, opacity: 1 },
  marker: { stroke: '#ffe14d', widthPx: 18, opacity: 0.8 },
  // 消しゴムはペイントレイヤーの中だけで使える. 色は使わない.
  eraser: { stroke: '#ffffff', widthPx: 24, opacity: 1 },
};
export const PEN_WIDTH_MAX_PX = 80;
// 白地の最初の色.
export const PAPER_DEFAULT = '#ffffff';
// 編集データに埋め込める元画像の大きさの上限(バイト).
export const EMBED_MAX_BYTES = 60 * 1024 * 1024;
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
// 文字の見た目の中心が, ベースラインより何em上にあるか. 標準のフォント(IBM Plex Sans JP)の「あ」「日」「H」の実測値(0.36〜0.39)に合わせている.
export const TEXT_INK_CENTER = 0.37;
export const TEXT_DEFAULTS = {
  content: 'テキスト', color: '#ffffff', bg: '#202020', transparent: false, sizePx: 24, font: 'plex', weight: 600,
  outline: '#000000', outlineWidthPx: 0,
};
// 縁取りの太さの範囲(UI上のpx).
export const OUTLINE_MAX_PX = 20;
// 番号の最初の設定. 丸の色と数字の色は, 図形とは別に, 直前に編集した値を引き継ぐ.
export const BADGE_DEFAULTS = { fill: '#d83b3b', stroke: '#ffffff', sizePx: 28 };
export const BADGE_MAX = 999;
// ぼかし・モザイクの強さ(UI上のpx). ぼかしは半径, モザイクは1マスの大きさ.
export const EFFECT_DEFAULTS = { strengthPx: 12 };
export const EFFECT_MIN_PX = 2;
export const EFFECT_MAX_PX = 60;
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
  toolSelect: 'select', toolCrop: 'crop', toolShape: 'shape', toolText: 'text', toolPen: 'pen',
};
export const TOOL_HINTS = {
  select: 'クリックで選択／空いた所のドラッグで範囲選択／Shift+クリックで選択に足す／ハンドルでサイズ変更・回転',
  crop: '枠をドラッグして切り抜き範囲を調整／上のボタンで画像を90°回転',
  shape: 'ドラッグして図形を配置／Shift を押しながらで正方形・45°',
  badge: 'クリックで番号を配置（置くたびに1つずつ増える）／ドラッグで大きさを指定',
  effect: 'ドラッグした範囲を, ぼかし・モザイクで隠す／Shift を押しながらで正方形',
  text: 'クリックしてテキストを配置',
  pen: 'ドラッグして描く／Shift を押しながらで直線（45°刻み）',
  paint: 'ペイントレイヤーに描く／Shift を押しながらで直線（45°刻み）',
};
export const TOOL_KEYS = {
  v: 'select', c: 'crop', r: 'shape', t: 'text', p: 'pen',
};
// 新しく置く図形の最初の設定. 以降は, 直前に編集した値を引き継ぐ.
export const SHAPE_DEFAULTS = {
  fill: '#f4c95d', stroke: '#ffffff', lineWidthPx: 4, opacity: 1,
};
export const inspectorFields = [
  'editX', 'editY', 'editAngle', 'editOpacity',
  'editWidth', 'editHeight', 'editFill', 'editStroke', 'editStyle', 'editLineWidth',
  'editTextContent', 'editTextColor', 'editTextBg', 'editTextTransparent', 'editTextSize', 'editTextFont', 'editTextWeight',
  'editTextOutline', 'editTextOutlineWidth', 'editStrength', 'editBadgeNumber', 'editCutout',
];
// ロック中は動かせないため, 位置・大きさ・角度の欄を無効にする.
export const geometryFields = ['editX', 'editY', 'editWidth', 'editHeight', 'editAngle'];
export const colorFields = ['editTextColor', 'editTextBg', 'editTextOutline', 'editFill', 'editStroke'];
export const orderButtons = ['bringFront', 'sendBack'];
export const inspectorControls = [
  ...inspectorFields, ...orderButtons, 'duplicateObject', 'deleteObject',
];
