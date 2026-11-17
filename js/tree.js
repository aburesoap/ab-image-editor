// レイヤーの階層(グループ). objects は背面から順の1列のまま持ち, 各オブジェクトに親のグループの id(parent)を持たせる.
// グループ(type: 'group')も objects の中にあり, 自分の中身(子孫)のすぐ前面(後ろの添字)に置く.
// 例: [a, b, 内, c, 外] は, 「外」の中に「内」(a, b)と c がある. 中身は必ずひと続きに並ぶ.
// グループは描かれず, 表示・ロックを中身へ及ぼす. 動かす・消す・複製するときは, 中身をまとめて扱う.

import { newObjectId, objects } from './state.js';

export const isGroup = (obj) => Boolean(obj) && obj.type === 'group';

const byId = (list = objects) => new Map(list.map((obj) => [obj.id, obj]));

// 親のグループ. 無ければ null.
export function parentOf(obj, map = byId()) {
  return obj && obj.parent != null ? map.get(obj.parent) || null : null;
}

// 親から順に, いちばん外側のグループまで.
export function ancestors(obj, map = byId()) {
  const list = [];
  let current = parentOf(obj, map);
  while (current && list.length < 64) {
    list.push(current);
    current = parentOf(current, map);
  }
  return list;
}

export const depthOf = (obj, map = byId()) => ancestors(obj, map).length;

// 自分か, 囲んでいるグループのどれかが隠れて(ロックされて)いるか.
export const hiddenDeep = (obj, map = byId()) => Boolean(obj.hidden) || ancestors(obj, map).some((g) => g.hidden);
export const lockedDeep = (obj, map = byId()) => Boolean(obj.locked) || ancestors(obj, map).some((g) => g.locked);

// いちばん外側のグループ(無ければ自分).
export function outermost(obj, map = byId()) {
  const list = ancestors(obj, map);
  return list.length ? list[list.length - 1] : obj;
}

// 添字 index のもの(グループなら中身ごと)が占める範囲 [start, end]. end は自分の添字.
export function subtreeRange(index, list = objects) {
  const obj = list[index];
  if (!isGroup(obj)) return [index, index];
  const map = byId(list);
  let start = index;
  while (start > 0 && ancestors(list[start - 1], map).includes(obj)) start -= 1;
  return [start, index];
}

// グループの中身(子孫). グループでなければ空.
export function descendantsOf(obj, list = objects) {
  const index = list.indexOf(obj);
  if (index < 0 || !isGroup(obj)) return [];
  const [start] = subtreeRange(index, list);
  return list.slice(start, index);
}

// 中身のうち, グループでないもの(描かれるもの). グループでなければ自分だけ.
export const leavesOf = (obj, list = objects) => (isGroup(obj) ? descendantsOf(obj, list).filter((o) => !isGroup(o)) : [obj]);

// 1列の並びと親の関係が崩れていないかを確かめ, 崩れていれば直す.
// 前面から順に見て, 親のグループが「今開いているグループ」でなければ, 外へ出す. 中身の無いグループは消す.
export function normalizeTree(list = objects) {
  const ids = new Set(list.map((obj) => obj.id));
  const stack = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const obj = list[i];
    if (obj.parent != null && !ids.has(obj.parent)) delete obj.parent;
    while (stack.length && stack[stack.length - 1].id !== obj.parent) stack.pop();
    if (!stack.length && obj.parent != null) delete obj.parent;
    if (isGroup(obj)) stack.push(obj);
  }
  // 中身の無いグループを消す(消すと親が空になることがあるので, 無くなるまで繰り返す).
  let removed = true;
  while (removed) {
    removed = false;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (isGroup(list[i]) && !(i > 0 && list[i - 1].parent === list[i].id)) {
        list.splice(i, 1);
        removed = true;
      }
    }
  }
  return list;
}

// 選んだもののうち, ほかに選んだグループの中にあるものを除く(グループごと扱うため).
export function topItems(items, map = byId()) {
  const set = new Set(items);
  return items.filter((obj) => !ancestors(obj, map).some((g) => set.has(g)));
}

// 中身ごと取り出す. 取り出したもの(背面から順)を返す.
function extract(index) {
  const [start, end] = subtreeRange(index);
  return objects.splice(start, end - start + 1);
}

// 添字 index のもの(中身ごと)を, 同じ親の中で1つ前面(dir = 1)・背面(dir = -1)の兄弟と入れ替える. 動けたら true.
export function stepItem(index, dir) {
  const obj = objects[index];
  if (!obj) return false;
  const [start, end] = subtreeRange(index);
  const parent = obj.parent ?? null;
  if (dir > 0) {
    // 前面の兄弟の見出し(兄弟がグループなら, 中身の後ろにある見出し)を探す. 親の見出しに着いたら, 自分が最前面.
    let j = end + 1;
    while (j < objects.length && (objects[j].parent ?? null) !== parent) {
      if (objects[j].id === parent) return false;
      j += 1;
    }
    if (j >= objects.length) return false;
    const moved = objects.splice(start, end - start + 1);
    objects.splice(j - moved.length + 1, 0, ...moved);
    return true;
  }
  const prev = objects[start - 1];
  if (!prev || (prev.parent ?? null) !== parent) return false;
  const [prevStart] = subtreeRange(start - 1);
  const moved = objects.splice(start, end - start + 1);
  objects.splice(prevStart, 0, ...moved);
  return true;
}

// 添字 index のもの(中身ごと)を, target の前面へ移し, target と同じ親に入れる. target が null なら, いちばん背面(親なし)へ.
// 自分の中身の中へは移せない(false を返す).
export function moveItemInFrontOf(index, target) {
  const obj = objects[index];
  if (!obj || obj === target) return false;
  if (target && (descendantsOf(obj).includes(target))) return false;
  const moved = extract(index);
  if (target) {
    if (target.parent != null) obj.parent = target.parent;
    else delete obj.parent;
    objects.splice(objects.indexOf(target) + 1, 0, ...moved);
  } else {
    delete obj.parent;
    objects.splice(0, 0, ...moved);
  }
  normalizeTree();
  return true;
}

// 選んだもの(背面から順でなくてよい)を, 新しいグループにまとめる. いちばん前面のものがあった所に, 中身ごと移す.
// 作ったグループを返す. まとめられなければ null.
export function groupItems(items, name) {
  const roots = topItems(items).sort((a, b) => objects.indexOf(a) - objects.indexOf(b));
  if (!roots.length) return null;
  const front = roots[roots.length - 1];
  const group = { id: newObjectId(), type: 'group', name, hidden: false, locked: false, collapsed: false };
  if (front.parent != null) group.parent = front.parent;
  // 取り出す範囲を集める.
  const ranges = roots.map((obj) => subtreeRange(objects.indexOf(obj)));
  const moving = new Set(ranges.flatMap(([s, e]) => objects.slice(s, e + 1)));
  const block = objects.filter((obj) => moving.has(obj));
  const frontEnd = objects.indexOf(front);
  const before = objects.slice(0, frontEnd + 1).filter((obj) => !moving.has(obj));
  const after = objects.slice(frontEnd + 1);
  roots.forEach((obj) => { obj.parent = group.id; });
  objects.length = 0;
  objects.push(...before, ...block, group, ...after);
  normalizeTree();
  return objects.includes(group) ? group : null;
}

// グループを解いて, 中身をグループの親へ移す. 中身(直接の子)を返す.
export function ungroup(group) {
  const index = objects.indexOf(group);
  if (index < 0 || !isGroup(group)) return [];
  const children = descendantsOf(group).filter((obj) => obj.parent === group.id);
  children.forEach((obj) => {
    if (group.parent != null) obj.parent = group.parent;
    else delete obj.parent;
  });
  objects.splice(index, 1);
  normalizeTree();
  return children;
}

// 中身ごとの複製. id を付け直し, 中の親の関係も新しい id へつなぎ直す. 背面から順の列を返す.
export function cloneSubtree(index) {
  const [start, end] = subtreeRange(index);
  const ids = new Map();
  const copies = objects.slice(start, end + 1).map((obj) => {
    const copy = { ...obj, id: newObjectId() };
    ids.set(obj.id, copy.id);
    return copy;
  });
  copies.forEach((copy) => {
    if (copy.parent != null && ids.has(copy.parent)) copy.parent = ids.get(copy.parent);
  });
  return copies;
}

// 添字 index のもの(中身ごと)を消す. 消したものを返す.
export const removeItem = (index) => extract(index);

// 同じ親の中に, 前面(dir = 1)・背面(dir = -1)の兄弟があるか(▲▼を押せるか).
export function hasSibling(index, dir) {
  const obj = objects[index];
  if (!obj) return false;
  const parent = obj.parent ?? null;
  const [start, end] = subtreeRange(index);
  if (dir > 0) {
    for (let j = end + 1; j < objects.length; j += 1) {
      if (objects[j].id === parent) return false;
      if ((objects[j].parent ?? null) === parent) return true;
    }
    return false;
  }
  const prev = objects[start - 1];
  return Boolean(prev) && (prev.parent ?? null) === parent;
}
