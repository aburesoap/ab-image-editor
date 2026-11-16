// 共有の状態. 複数のモジュールから書き換えるため, 1つのオブジェクトにまとめている.
import {
  BADGE_DEFAULTS, EFFECT_DEFAULTS, FULL_CROP, SHAPE_DEFAULTS, TEXT_DEFAULTS,
} from './constants.js';

// 状態. 値を代入し直すものは, このオブジェクトのプロパティとして持つ.
export const state = {
  sourceImage: null,
  sourceURL: null,
  sourceName: '',
  grayscale: false,
  // 現在の道具(select / crop / shape / text)と, ステージの表示(edit / result).
  tool: 'select',
  view: 'edit',
  // 図形・テキストを置いたあとも, 同じ道具のままにするか.
  toolLock: false,
  // 次に置く図形の種類.
  shapeType: 'rect',
  // 直前に編集した値. 次に置く図形・テキストへ引き継ぐ.
  lastShape: { ...SHAPE_DEFAULTS },
  lastText: {
    color: TEXT_DEFAULTS.color,
    bg: TEXT_DEFAULTS.bg,
    transparent: TEXT_DEFAULTS.transparent,
    sizePx: TEXT_DEFAULTS.sizePx,
    font: TEXT_DEFAULTS.font,
    weight: TEXT_DEFAULTS.weight,
    outline: TEXT_DEFAULTS.outline,
    outlineWidthPx: TEXT_DEFAULTS.outlineWidthPx,
    opacity: 1,
  },
  lastBadge: { fill: BADGE_DEFAULTS.fill, stroke: BADGE_DEFAULTS.stroke },
  lastEffect: { strengthPx: EFFECT_DEFAULTS.strengthPx },
  selectedIndex: -1,
  converted: false,
  converting: false,
  // 結果を無効化するたびに増やす. 変換中に編集された場合, 古い結果を破棄するために使う.
  resultVersion: 0,
  // 変換結果の縮小見本. 画面の再描画で結果が消えていないかを調べるために使う.
  resultProbe: null,
  // 最後に保存した時点の編集内容. 未保存の編集があるかを調べるために使う.
  savedSignature: '',
  crop: { ...FULL_CROP },
  // 元画像の向き(0 / 90 / 180 / 270, 時計回りの角度). 元画像そのものは書き換えず, 描画時に回す.
  rotation: 0,
  // 編集表示の拡大率と位置. fit がtrueなら, 作業領域に収まる大きさで表示する.
  // scale はキャンバス1pxあたりの表示px, panX / panY は中央からのずれ(表示px).
  zoom: { fit: true, scale: 1, panX: 0, panY: 0 },
  pointerAction: null,
  currentShape: null,
  historyTimer: 0,
  drawFrame: 0,
  worker: null,
  // オブジェクトに付ける通し番号. 元に戻したあとも, 同じオブジェクトを選んだままにするために使う.
  nextObjectId: 1,
};

// 描画順の配列. 先頭が最背面, 末尾が最前面. 図形とテキストを同じ配列で扱う.
export const objects = [];
export const history = [];
export const future = [];
// 編集パネルへ最後に書き込んだ値. ユーザーが実際に触った項目だけを反映するために使う.
export const fieldSnapshot = {};
// 新しく置く(または読み込む・複製する)オブジェクトに, 重ならない番号を付ける.
export const newObjectId = () => {
  const id = state.nextObjectId;
  state.nextObjectId += 1;
  return id;
};
export const selectedObject = () => (state.selectedIndex >= 0 ? objects[state.selectedIndex] || null : null);
