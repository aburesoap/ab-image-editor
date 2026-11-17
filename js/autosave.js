// 自動保存. 編集するたびに, 元画像・重ねた画像・編集内容を, ブラウザの中(IndexedDB)へ保存しておく.
// 次に開いたとき, 起動画面の「前回の続き」から元に戻せる. 保存するのは最後の1件だけで, 端末の外へは送らない.
// ファイルメニューの「この端末に自動保存する」で止められる(止めると, 保存してあるものも消す).

import { $, setStatus } from './dom.js';
import { history, state } from './state.js';
import { onHistoryChange } from './history.js';
import {
  applyProjectData, checkProject, projectData, projectErrorMessage, usedImageIds,
} from './project.js';
import { imageAsset } from './image-layer.js';
import { openImage } from './open.js';

const DB_NAME = 'image-editor';
const STORE = 'autosave';
const KEY = 'current';
const SETTING_KEY = 'image-editor-autosave';
// 編集が止まってから保存するまでの時間(ミリ秒).
const DELAY = 800;

let timer = 0;
let failed = false;
// 保存中の処理. テストや画面の切り替えで, 保存が終わるのを待てるようにする.
let pending = Promise.resolve();

// 設定は端末ごとに覚える. 読めない(プライベートブラウズなど)ときは, オンにしておく.
export function autosaveEnabled() {
  try {
    return window.localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setEnabled(on) {
  try {
    window.localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // 覚えられなくても, 今の画面では切り替えたとおりに動く.
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('no indexedDB'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 保存場所に対して1つの操作をする. fn は store を受け取り, 結果を返す要求(IDBRequest)を返す.
async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const readAutosave = () => withStore('readonly', (store) => store.get(KEY)).catch(() => null);
const clearAutosave = () => withStore('readwrite', (store) => store.delete(KEY)).catch(() => {});

async function save() {
  if (!autosaveEnabled() || !state.sourceImage || !state.sourceBlob) return;
  // 開いただけで編集していないときは保存しない(前回の続きを, 開いただけで上書きしないため).
  if (history.length <= 1) return;
  const project = projectData();
  const assets = usedImageIds(project).map((id) => ({ id, blob: imageAsset(id).blob, name: imageAsset(id).name }));
  const record = {
    savedAt: Date.now(),
    name: state.sourceName,
    sourceBlob: state.sourceBlob,
    project,
    assets,
  };
  try {
    await withStore('readwrite', (store) => store.put(record, KEY));
    failed = false;
  } catch {
    // 容量が足りないときなど. 何度も知らせないよう, 続けて失敗している間は1回だけにする.
    if (!failed) setStatus('自動保存できませんでした（ブラウザの保存領域が足りない可能性があります）. 編集データの保存をお使いください');
    failed = true;
  }
}

function scheduleSave() {
  if (!autosaveEnabled()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    pending = pending.then(save);
  }, DELAY);
}

// 保存を待っている編集があれば, すぐに保存して終わるのを待つ.
export function flushAutosave() {
  if (timer) {
    window.clearTimeout(timer);
    timer = 0;
    pending = pending.then(save);
  }
  return pending;
}

onHistoryChange(scheduleSave);
// 画面を閉じる・別のタブへ移るときは, 待たずに保存する.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutosave();
});

// ---- 起動画面の「前回の続き」 ----
function formatTime(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function showResume() {
  const record = autosaveEnabled() ? await readAutosave() : null;
  const box = $('resumeBox');
  // 確かめている間に画像を開いていたら, 出さない.
  if (!record || state.sourceImage) {
    box.hidden = true;
    return;
  }
  const count = Array.isArray(record.project?.document?.objects) ? record.project.document.objects.filter((obj) => obj?.type !== 'base').length : 0;
  $('resumeInfo').textContent = `${formatTime(record.savedAt)}・${record.name || '画像'}・レイヤー ${count}`;
  box.hidden = false;
}

export async function resumeAutosave() {
  const record = await readAutosave();
  if (!record || !(record.sourceBlob instanceof Blob)) {
    setStatus('前回の続きが見つかりませんでした');
    $('resumeBox').hidden = true;
    return false;
  }
  try {
    checkProject(record.project);
    if (!(await openImage(record.sourceBlob, record.name || '前回の画像', '復元'))) return false;
    await applyProjectData(record.project, Array.isArray(record.assets) ? record.assets : []);
    // 開き直した時点の保存状態(未保存)のままにする. ファイルには保存していないため.
    setStatus(`前回の続きを開きました（${formatTime(record.savedAt)} に自動保存）`);
    return true;
  } catch (error) {
    setStatus(projectErrorMessage(error));
    return false;
  }
}

$('resumeAutosave').addEventListener('click', resumeAutosave);
$('discardAutosave').addEventListener('click', async () => {
  if (!window.confirm('自動保存した前回の続きを消します. よろしいですか？')) return;
  await clearAutosave();
  $('resumeBox').hidden = true;
  setStatus('前回の続きを消しました');
});

// ---- ファイルメニューの切り替え ----
$('autosaveToggle').checked = autosaveEnabled();
$('autosaveToggle').addEventListener('change', async () => {
  const on = $('autosaveToggle').checked;
  setEnabled(on);
  if (on) {
    setStatus('自動保存をオンにしました. 編集すると, この端末のブラウザの中に保存します');
    scheduleSave();
  } else {
    window.clearTimeout(timer);
    timer = 0;
    await pending;
    await clearAutosave();
    $('resumeBox').hidden = true;
    setStatus('自動保存をオフにし, 保存してあった前回の続きを消しました');
  }
});

showResume();
