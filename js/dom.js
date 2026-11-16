// 画面要素への参照と, 画面まわりの小さな共通処理.

export const $ = (id) => document.getElementById(id);
export const file = $('file');
export const original = $('original');
export const result = $('result');
export const octx = original.getContext('2d');
export const rctx = result.getContext('2d');
export const setDisabled = (ids, disabled) => ids.forEach((id) => { $(id).disabled = disabled; });

export function setStatus(message) {
  $('status').textContent = message;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // 保存先の選択画面が長く開かれていても取得に失敗しないよう, 解放までの時間に余裕を持たせる.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
