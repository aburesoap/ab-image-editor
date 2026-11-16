// 変換結果の保存(形式, ファイル名, 画質).

import { DEFAULT_EXPORT_NAME, EXPORT_FORMATS } from './constants.js';
import { $, downloadBlob, result, setStatus } from './dom.js';
import { state } from './state.js';
import { convertImage, isBlankProbe, probeCanvas } from './convert.js';
import { markSaved } from './history.js';

function currentExportFormat() {
  return EXPORT_FORMATS[$('exportFormat').value] || EXPORT_FORMATS.png;
}

// ファイル名に使えない文字や, 重複しやすい拡張子を取り除く. 空になった場合は既定の名前に戻す.
function sanitizeFileName(raw) {
  const name = String(raw)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/[. ]+$/, '');
  return name.slice(0, 120) || DEFAULT_EXPORT_NAME;
}

function updateExportUI() {
  const format = currentExportFormat();
  $('exportQualityRow').hidden = !format.lossy;
  $('exportQualityVal').textContent = `${$('exportQuality').value}%`;
  $('exportNote').textContent = format.note;
}

function encodeResult(format, quality) {
  return new Promise((resolve, reject) => {
    let canvas = result;
    if (format.mime === 'image/jpeg') {
      // JPEGは透過に対応しないため, 白い背景へ重ねてから書き出す.
      canvas = document.createElement('canvas');
      canvas.width = result.width;
      canvas.height = result.height;
      const flatCtx = canvas.getContext('2d');
      flatCtx.fillStyle = '#ffffff';
      flatCtx.fillRect(0, 0, canvas.width, canvas.height);
      flatCtx.drawImage(result, 0, 0);
    }
    canvas.toBlob((blob) => {
      if (canvas !== result) {
        canvas.width = 0;
        canvas.height = 0;
      }
      // 非対応の形式を指定すると, ブラウザはPNGで返す. 別形式で保存してしまわないよう確認する.
      if (!blob || blob.type !== format.mime) reject(new Error('unsupported format'));
      else resolve(blob);
    }, format.mime, format.lossy ? quality : undefined);
  });
}

// 仕上がりの画像を用意する. 未作成の場合や, 画面が裏に回っている間に消えていた場合は, 作り直す.
async function ensureResult() {
  const lost = state.converted && state.resultProbe && !isBlankProbe(state.resultProbe) && isBlankProbe(probeCanvas(result));
  if (state.converted && !lost) return true;
  return convertImage();
}

async function saveResult() {
  if (!state.sourceImage) return;
  if (state.converting) {
    setStatus('変換中です. 完了後にもう一度保存してください');
    return;
  }
  const format = currentExportFormat();
  const baseName = sanitizeFileName($('exportName').value);
  const fileName = `${baseName}.${format.ext}`;
  $('exportName').value = baseName;

  // 保存先を選べる環境では「名前を付けて保存」のダイアログを先に開く(ボタンを押した直後でないと開けないため).
  // 使えない環境では, ダウンロードにする.
  let handle = null;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: format.label, accept: { [format.mime]: [`.${format.ext}`] } }],
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setStatus('保存をキャンセルしました');
        return;
      }
      handle = null;
    }
  }

  if (!(await ensureResult())) return;

  try {
    const blob = await encodeResult(format, Number($('exportQuality').value) / 100);
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`保存しました：${handle.name}`);
    } else {
      downloadBlob(blob, fileName);
      setStatus(`ダウンロードを開始しました：${fileName}`);
    }
    markSaved();
  } catch (error) {
    console.error(error);
    setStatus(error.message === 'unsupported format'
      ? 'このブラウザでは選択した形式で保存できません. 別の形式を選んでください'
      : '保存に失敗しました');
  }
}

// 仕上がりの画像を, PNGとしてクリップボードへコピーする. 保存と同じく, 未作成なら先に作る.
async function copyResult() {
  if (!state.sourceImage) return;
  if (state.converting) {
    setStatus('変換中です. 完了後にもう一度コピーしてください');
    return;
  }
  if (!navigator.clipboard?.write || typeof window.ClipboardItem !== 'function') {
    setStatus('このブラウザでは, 画像をクリップボードへコピーできません. 「保存」をお使いください');
    return;
  }
  try {
    // ボタンを押した直後でないとコピーできないため, 画像の用意を待たずに書き込みを始め, 中身は後から渡す.
    const blob = ensureResult().then((done) => {
      if (!done) throw new Error('convert failed');
      return encodeResult(EXPORT_FORMATS.png);
    });
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
    setStatus(`仕上がりの画像をコピーしました（PNG, ${result.width} × ${result.height} px）`);
  } catch (error) {
    if (error.message !== 'convert failed') {
      console.error(error);
      setStatus('コピーできませんでした. 画面を一度クリックしてから, もう一度お試しください');
    }
  }
}

$('download').addEventListener('click', saveResult);
$('copyImage').addEventListener('click', copyResult);
$('exportFormat').addEventListener('change', updateExportUI);
$('exportQuality').addEventListener('input', updateExportUI);
$('exportName').addEventListener('change', () => {
  $('exportName').value = sanitizeFileName($('exportName').value);
});
updateExportUI();
