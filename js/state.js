// 共有の状態. 複数のモジュールから書き換えるため, 1つのオブジェクトにまとめている.
import {
  BADGE_DEFAULTS, EFFECT_DEFAULTS, FULL_CROP, PEN_DEFAULTS, SHAPE_DEFAULTS, TEXT_DEFAULTS,
} from './constants.js';

// 状態. 値を代入し直すものは, このオブジェクトのプロパティとして持つ.
export const state = {
  sourceImage: null,
  sourceURL: null,
  sourceName: '',
  grayscale: false,
  // 現在の道具(select / crop / shape / text / pen)と, ステージの表示(edit / result).
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
  // ペンの種類(pen / marker / eraser)と, 種類ごとに直前に使った色・太さ・不透明度.
  penType: 'pen',
  lastPen: { pen: { ...PEN_DEFAULTS.pen }, marker: { ...PEN_DEFAULTS.marker }, eraser: { ...PEN_DEFAULTS.eraser } },
  // 開いている元画像のファイル(編集データへ埋め込むときに使う).
  sourceBlob: null,
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
  // ペイントレイヤーへ描いている途中の線. targetId は描き先のレイヤーの id.
  currentStroke: null,
  historyTimer: 0,
  drawFrame: 0,
  worker: null,
  // オブジェクトに付ける通し番号. 元に戻したあとも, 同じオブジェクトを選んだままにするために使う.
  nextObjectId: 1,
  // 整列のガイドで表示する線({ x: [...], y: [...] }, canvas上のpx). 動かしている間だけ持つ.
  guideLines: null,
};

// 選択. 1つだけ選んでいるときは selectedIndex(オブジェクトの添字), 2つ以上のときは multiIds(オブジェクトの id の列)に持つ.
// selectedIndex へ代入すると, 複数の選択は解除される(1つを選び直した, 選択を外した, のどちらでも).
// 複数を選ぶときは, selectedIndex に -1 を入れてから multiIds を入れる(selection.js の selectMany).
let selectedIndexValue = -1;
Object.defineProperty(state, 'selectedIndex', {
  enumerable: true,
  get: () => selectedIndexValue,
  set: (value) => {
    selectedIndexValue = value;
    state.multiIds = [];
  },
});
state.multiIds = [];

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
// 元画像のレイヤー. 画像を開くたびに1つだけ作り, いちばん下に置く(重ね順は後から変えられる).
export const makeBaseLayer = () => ({
  id: newObjectId(),
  type: 'base',
  style: 'fill',
  fill: '#ffffff',
  stroke: '#ffffff',
  lineWidth: 0,
  opacity: 1,
  rotation: 0,
  hidden: false,
  locked: false,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
});
export const selectedObject = () => (state.selectedIndex >= 0 ? objects[state.selectedIndex] || null : null);
