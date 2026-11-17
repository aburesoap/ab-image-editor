// 道具・表示・パネルの切り替えと, オブジェクトの操作(削除・複製・重ね順など).

import {
  MAX_OBJECTS, PAPER_DEFAULT, TOOL_BUTTONS, TOOL_HINTS,
} from './constants.js';
import { $, original, setStatus } from './dom.js';
import { newObjectId, objects, selectedObject, state } from './state.js';
import {
  isBadge, isBase, isEffectType, isFullLayer, isImage, isPaint, moveObject, sourceSize,
} from './geometry.js';
import { imageAsset, initialImageFrame, registerImageAsset } from './image-layer.js';
import { nextBadgeNumber, syncWindowStyleOption } from './shapes.js';
import { drawEditor } from './render.js';
import { updateStageView } from './stage.js';
import { updateSelectionInspector } from './inspector.js';
import { convertImage } from './convert.js';
import { commitChange, pushHistory } from './history.js';
import {
  isMulti, selectMany, selectedObjects,
} from './selection.js';
import {
  cloneSubtree, descendantsOf, groupItems, isGroup, lockedDeep, moveItemInFrontOf, normalizeTree, removeItem, stepItem,
  topItems, ungroup,
} from './tree.js';

// 操作の案内. 図形の道具では, 番号とぼかし・モザイクの置き方が違うので, 種類に合わせる.
function toolHint() {
  if (state.tool === 'pen' && selectedObject() && isPaint(selectedObject())) {
    return state.penType === 'move' ? TOOL_HINTS.paintMove : TOOL_HINTS.paint;
  }
  if (state.tool !== 'shape') return TOOL_HINTS[state.tool];
  if (state.shapeType === 'badge') return TOOL_HINTS.badge;
  if (isEffectType(state.shapeType)) return TOOL_HINTS.effect;
  return TOOL_HINTS.shape;
}

// 選んでいる道具に合わせて, 道具の強調, オプションバー, 操作の案内, カーソルを切り替える.
export function updateToolUI() {
  Object.entries(TOOL_BUTTONS).forEach(([id, tool]) => {
    $(id).classList.toggle('active', state.tool === tool);
    $(id).setAttribute('aria-pressed', String(state.tool === tool));
  });
  $('optSelect').hidden = state.tool !== 'select';
  $('optCrop').hidden = state.tool !== 'crop';
  $('optShape').hidden = state.tool !== 'shape';
  $('optPen').hidden = state.tool !== 'pen';
  $('optLock').hidden = state.tool !== 'shape' && state.tool !== 'text';
  $('toolHint').textContent = toolHint();
  original.className = `tool-${state.tool}`;
}

// 道具を切り替える. 選択以外の道具に切り替えたときは, 選択を解除する.
export function setTool(tool, keepSelection = false) {
  state.tool = tool;
  state.view = 'edit';
  state.pointerAction = null;
  state.currentShape = null;
  // ペンに持ち替えたときは, 選んでいるペイントレイヤーを描き先として選んだままにする.
  const keepPaint = tool === 'pen' && selectedObject() && isPaint(selectedObject());
  if (tool !== 'select' && !keepSelection && !keepPaint) state.selectedIndex = -1;
  updateToolUI();
  updateStageView();
  updateSelectionInspector();
  drawEditor();
}

// 図形・テキストを置いたあとの処理. 「連続して配置」がOFFなら, 選択の道具へ戻る.
export function afterPlacement() {
  if (state.toolLock) return;
  setTool('select', true);
}

// ステージの表示を, 編集と仕上がりの間で切り替える. 仕上がりが未作成なら, 変換してから表示する.
export async function setView(view) {
  state.view = view;
  state.pointerAction = null;
  updateStageView();
  if (view === 'result' && !state.converted) await convertImage();
}

// 右のパネルのタブを切り替える. 画面の狭い端末では, 閉じていたパネルも開く.
export function showTab(name) {
  const props = name === 'props';
  $('tabProps').classList.toggle('active', props);
  $('tabFinish').classList.toggle('active', !props);
  $('paneProps').hidden = !props;
  $('paneFinish').hidden = props;
  $('panel').classList.remove('collapsed');
}

// タブを押したときの処理. 開いているタブをもう一度押すと, 画面の狭い端末ではパネルを閉じる.
export function onTabClick(name) {
  const active = name === 'props' ? !$('paneProps').hidden : !$('paneFinish').hidden;
  if (active && !$('panel').classList.contains('collapsed')) $('panel').classList.add('collapsed');
  else showTab(name);
}

// 新規の図形の種類に合わせて, 描画方法の選択肢を整える.
export function syncShapeOptions() {
  syncWindowStyleOption($('shapeStyle'), state.shapeType);
  // 番号とぼかし・モザイクには, 描画方法が無い.
  $('shapeStyle').disabled = state.shapeType === 'badge' || isEffectType(state.shapeType);
  // ぼかし・モザイクは, くり抜きにできない.
  $('shapeCutout').disabled = isEffectType(state.shapeType);
  $('toolHint').textContent = toolHint();
}

// 重ね順を変える処理 fn を行い, 選択は同じオブジェクトに付けたままにする. 変わったら履歴に残す.
function reorder(fn) {
  const selected = selectedObject();
  const multiIds = [...state.multiIds];
  const before = objects.map((obj) => `${obj.id}:${obj.parent ?? ''}`).join();
  fn();
  state.selectedIndex = selected ? objects.indexOf(selected) : -1;
  // 複数を選んでいるときは, 選んだままにする.
  if (multiIds.length >= 2) state.multiIds = multiIds.filter((id) => objects.some((obj) => obj.id === id));
  updateSelectionInspector();
  if (objects.map((obj) => `${obj.id}:${obj.parent ?? ''}`).join() !== before) commitChange();
  else drawEditor();
}

// 添字 index のもの(グループなら中身ごと)を, 同じグループの中で1つ前面(dir = 1)・背面(dir = -1)へ.
export function stepObject(index, dir) {
  reorder(() => stepItem(index, dir));
}

// 添字 index のものを, target(オブジェクト)の前面へ移し, target と同じグループに入れる. target が null なら最背面へ.
// 元画像のレイヤーは, グループに入れない.
export function dropObject(index, target) {
  const obj = objects[index];
  if (!obj) return;
  if (isBase(obj) && target && target.parent != null) {
    setStatus('元画像のレイヤーは, グループに入れられません');
    return;
  }
  reorder(() => {
    if (!moveItemInFrontOf(index, target)) setStatus('グループを, 自分の中へは移せません');
  });
}

// 選択中のものを, 同じグループの中で最前面・最背面へ.
export function reorderSelected(kind) {
  const obj = selectedObject();
  if (!obj) return;
  const dir = kind === 'front' ? 1 : -1;
  reorder(() => {
    for (let i = 0; i < MAX_OBJECTS && stepItem(objects.indexOf(obj), dir); i += 1);
  });
}

// レイヤー一覧などから, オブジェクトを選ぶ. 選択以外の道具を持っていれば, 選択の道具へ持ち替える.
export function selectObject(index) {
  state.selectedIndex = index >= 0 && index < objects.length ? index : -1;
  // ペンの道具のままペイントレイヤーを選んだときは, 描き先を切り替えるだけにする(道具は持ち替えない).
  const paintTarget = state.tool === 'pen' && state.view === 'edit' && selectedObject() && isPaint(selectedObject());
  if (paintTarget) {
    updateSelectionInspector();
    updateToolUI();
    drawEditor();
  } else if (state.tool !== 'select' || state.view !== 'edit') {
    setTool('select', true);
  } else {
    updateSelectionInspector();
    drawEditor();
  }
}

// 表示・非表示を切り替える. 隠したオブジェクトは, プレビューにも書き出しにも描かない.
export function toggleHidden(index) {
  const obj = objects[index];
  if (!obj) return;
  obj.hidden = !obj.hidden;
  updateSelectionInspector();
  commitChange();
}

// ロックを切り替える. ロック中はプレビュー上で選べず, 動かせない(見た目は変わらないので, 変換結果はそのまま).
export function toggleLocked(index) {
  const obj = objects[index];
  if (!obj) return;
  obj.locked = !obj.locked;
  updateSelectionInspector();
  drawEditor();
  pushHistory();
}

// 指定した添字のオブジェクトを消す. ロック中のものは, 誤って消さないよう削除しない(ロックを解除してから削除する).
// 別のオブジェクトを選んでいた場合は, 選択をそのオブジェクトに付けたままにする.
export function deleteObjectAt(index) {
  const obj = objects[index];
  if (!obj) return;
  const reason = undeletableReason(obj);
  if (reason) {
    setStatus(reason);
    return;
  }
  const selected = selectedObject();
  const removed = removeItem(index);
  normalizeTree();
  state.selectedIndex = selected && !removed.includes(selected) ? objects.indexOf(selected) : -1;
  updateSelectionInspector();
  commitChange();
}

// 消せない理由. 消せるなら空文字.
function undeletableReason(obj) {
  if (isBase(obj)) return '元画像のレイヤーは消せません. 隠すときは, レイヤー一覧の目のボタンを使ってください';
  if (lockedDeep(obj) || descendantsOf(obj).some((item) => item.locked)) {
    return 'ロック中のため削除できません. レイヤー一覧の錠前で解除してください';
  }
  return '';
}

export function deleteSelected() {
  if (!isMulti()) {
    deleteObjectAt(state.selectedIndex);
    return;
  }
  // 複数を選んでいるときは, ロック中のもの(ロック中のものを含むグループ)と元画像を残して消し, 残ったものは選んだままにする.
  const list = topItems(selectedObjects());
  const locked = list.filter((obj) => undeletableReason(obj));
  if (locked.length === list.length) {
    setStatus('ロック中のため削除できません. レイヤー一覧の錠前で解除してください');
    return;
  }
  const removed = new Set(list.filter((obj) => !locked.includes(obj)));
  removed.forEach((obj) => removeItem(objects.indexOf(obj)));
  normalizeTree();
  selectMany(locked.filter((obj) => objects.includes(obj)));
  updateSelectionInspector();
  commitChange();
  setStatus(`${removed.size} 個を削除しました${locked.length ? `（ロック中・元画像の ${locked.length} 個は残しました）` : ''}`);
}

// 作業領域で選べるもの(隠したもの・ロックしたもの・白地・ペイントを除く)をすべて選ぶ.
export function selectAll() {
  if (!state.sourceImage || state.view !== 'edit') return;
  if (state.tool !== 'select') setTool('select');
  // いちばん外側のもの(グループはグループごと)を選ぶ.
  selectMany(objects.filter((obj) => obj.parent == null && !obj.hidden && !obj.locked && !isFullLayer(obj)));
  updateSelectionInspector();
  drawEditor();
}

export function duplicateSelected() {
  if (isMulti()) {
    duplicateMany();
    return;
  }
  const source = selectedObject();
  if (!source || isBase(source)) return;
  const copy = duplicateItem(source);
  if (!copy) return;
  state.selectedIndex = objects.indexOf(copy);
  updateSelectionInspector();
  commitChange();
}

// 白地を, 元画像のすぐ上に足して選ぶ. 白地の上に描けば, 簡単なお絵描きにも使える.
export function addPaper() {
  if (!state.sourceImage || objects.length >= MAX_OBJECTS) return;
  const at = objects.findIndex(isBase) + 1;
  objects.splice(at, 0, {
    id: newObjectId(),
    type: 'paper',
    style: 'fill',
    fill: PAPER_DEFAULT,
    stroke: PAPER_DEFAULT,
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
  state.selectedIndex = at;
  if (state.tool !== 'select') setTool('select', true);
  updateSelectionInspector();
  showTab('props');
  commitChange();
}

// ペイントレイヤーを, いちばん上に足して選び, ペンの道具に持ち替える.
// ペイントレイヤーを選んでいる間は, ペン・蛍光ペン・消しゴムの線がそのレイヤーの中に描かれる.
export function addPaint() {
  if (!state.sourceImage || objects.length >= MAX_OBJECTS) return;
  objects.push({
    id: newObjectId(),
    type: 'paint',
    style: 'fill',
    fill: PAPER_DEFAULT,
    stroke: PAPER_DEFAULT,
    lineWidth: 0,
    opacity: 1,
    rotation: 0,
    hidden: false,
    locked: false,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    strokes: [],
  });
  state.selectedIndex = objects.length - 1;
  setTool('pen');
  updateSelectionInspector();
  showTab('props');
  commitChange();
}

// 画像を, 画像レイヤーとしていちばん上に重ねる. 複数なら少しずつずらして重ね, 最後のものを選ぶ.
// 足せた枚数で解決する.
export async function addImageLayers(files) {
  if (!state.sourceImage) return 0;
  const { w: W, h: H } = sourceSize();
  let added = 0;
  let skipped = 0;
  for (const blob of files) {
    if (objects.length >= MAX_OBJECTS) break;
    // 素材の読み込みを待つ間に, 別の画像を開き直していたらやめる.
    const source = state.sourceImage;
    const imageId = await registerImageAsset(blob, blob.name || '貼り付けた画像');
    if (state.sourceImage !== source) return added;
    if (!imageId) {
      skipped += 1;
      continue;
    }
    objects.push({
      id: newObjectId(),
      type: 'image',
      imageId,
      name: imageAsset(imageId).name,
      style: 'fill',
      fill: '#ffffff',
      stroke: '#ffffff',
      lineWidth: 0,
      opacity: 1,
      rotation: 0,
      hidden: false,
      locked: false,
      ...initialImageFrame(imageAsset(imageId).image, W, H, added * 0.03),
    });
    added += 1;
  }
  if (added) {
    state.selectedIndex = objects.length - 1;
    if (state.tool !== 'select' || state.view !== 'edit') setTool('select', true);
    updateSelectionInspector();
    showTab('props');
    commitChange();
  }
  const sizeNote = skipped ? `（${skipped} 枚は, 形式に対応していないか大きすぎるため, 重ねられませんでした）` : '';
  if (added) setStatus(`画像を ${added} 枚重ねました${sizeNote}`);
  else if (skipped) setStatus('画像を重ねられませんでした. PNG / JPEG / WebP / GIF / BMP / AVIF（60MBまで）を選んでください');
  return added;
}

// 選んでいる画像レイヤーの縦横比を, 元の画像と同じにする. 幅はそのままにし, 中心を保って高さを合わせる.
export function resetImageAspect() {
  const obj = selectedObject();
  const asset = obj && isImage(obj) ? imageAsset(obj.imageId) : null;
  if (!asset || obj.locked) return;
  const { w: W, h: H } = sourceSize();
  const widthPx = Math.abs(obj.x2 - obj.x1) * W;
  const heightPx = widthPx * asset.image.naturalHeight / asset.image.naturalWidth;
  const cy = (obj.y1 + obj.y2) / 2;
  const sign = obj.y2 >= obj.y1 ? 1 : -1;
  obj.y1 = cy - sign * heightPx / H / 2;
  obj.y2 = cy + sign * heightPx / H / 2;
  updateSelectionInspector();
  commitChange();
}

// 1つ(グループなら中身ごと)を複製して, 元のすぐ前面に少しずらして置く. 複製したもの(グループなら見出し)を返す.
// 複製したものは, 隠れていたりロックされていたりしても, 見えて動かせる状態にする. 番号は, 次の番号にする.
function duplicateItem(source) {
  const index = objects.indexOf(source);
  const copies = cloneSubtree(index);
  if (objects.length + copies.length > MAX_OBJECTS) {
    setStatus('これ以上は置けないため, 複製できません');
    return null;
  }
  const root = copies[copies.length - 1];
  root.hidden = false;
  root.locked = false;
  copies.forEach((copy) => {
    if (isBadge(copy)) copy.number = nextBadgeNumber();
    moveObject(copy, 0.02, 0.02);
  });
  objects.splice(index + 1, 0, ...copies);
  return root;
}

// 選んでいるものをまとめて複製する. 複製はそれぞれ元のすぐ前面に置き, 複製したものを選ぶ.
function duplicateMany() {
  const copies = [];
  topItems(selectedObjects()).filter((obj) => !isBase(obj)).forEach((source) => {
    const copy = duplicateItem(source);
    if (copy) copies.push(copy);
  });
  selectMany(copies);
  updateSelectionInspector();
  commitChange();
}

// 選んでいるもの(元画像を除く)を, 新しいグループにまとめて選ぶ(Ctrl+G).
export function groupSelected() {
  const items = selectedObjects().filter((obj) => !isBase(obj));
  if (!items.length) {
    setStatus('まとめるものを選んでください（元画像のレイヤーはグループに入れられません）');
    return;
  }
  const count = objects.filter(isGroup).length + 1;
  const group = groupItems(items, `グループ ${count}`);
  if (!group) return;
  state.selectedIndex = objects.indexOf(group);
  updateSelectionInspector();
  commitChange();
  setStatus(`${group.name} にまとめました. レイヤー一覧で開閉でき, 中のものは Ctrl+クリックで選べます`);
}

// 選んでいるグループを解いて, 中身を選ぶ(Ctrl+Shift+G).
export function ungroupSelected() {
  const groups = topItems(selectedObjects()).filter(isGroup);
  if (!groups.length) return;
  const children = groups.flatMap((group) => ungroup(group));
  selectMany(children);
  updateSelectionInspector();
  commitChange();
  setStatus('グループを解きました');
}

// 元画像のレイヤーだけを残して, すべて消す.
export function clearAll() {
  const base = objects.filter(isBase);
  objects.length = 0;
  objects.push(...base);
  state.currentShape = null;
  state.selectedIndex = -1;
  updateSelectionInspector();
  commitChange();
}
