// 変換結果の管理と, 変換の実行(Web Workerへの受け渡し).

import { $, rctx, result, setStatus } from './dom.js';
import { objects, state } from './state.js';
import { cropPixels, getDimensions, sourceSize } from './geometry.js';
import { loadFontsFor } from './text.js';
import { buildCompositeCanvas } from './render.js';
import { readConversionSettings } from './settings.js';
import { updateStageView } from './stage.js';

const RESULT_EMPTY_TEXT = '「仕上がりを作る」で, 書き出す画像を表示します';

export function invalidateResult() {
  state.resultVersion += 1;
  state.converted = false;
  $('resultEmptyText').textContent = RESULT_EMPTY_TEXT;
  updateStageView();
}

function runWorker(imageData, settings) {
  if (!state.worker) state.worker = new Worker('image-worker.js');
  const current = state.worker;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      current.removeEventListener('message', onMessage);
      current.removeEventListener('error', onError);
    };
    const onMessage = (event) => { cleanup(); resolve(event.data); };
    const onError = (event) => {
      cleanup();
      // 異常終了したWorkerは破棄し, 次回の変換で作り直す.
      current.terminate();
      if (state.worker === current) state.worker = null;
      reject(event.error || new Error('Worker error'));
    };
    current.addEventListener('message', onMessage);
    current.addEventListener('error', onError);
    current.postMessage(
      { buffer: imageData.data.buffer, width: imageData.width, height: imageData.height, settings },
      [imageData.data.buffer],
    );
  });
}

function setConvertBusy(busy) {
  const idle = !busy && Boolean(state.sourceImage);
  $('convert').disabled = !idle;
  $('showResult').disabled = !idle;
  $('grayscale').disabled = !idle;
  $('download').disabled = !idle;
}

// 変換して結果を表示する. 結果が作られたときだけ true を返す.
export async function convertImage() {
  if (!state.sourceImage || state.converting) return false;
  state.converting = true;
  invalidateResult();
  const version = state.resultVersion;
  $('resultEmptyText').textContent = '変換中です…';
  setConvertBusy(true);
  setStatus('変換中です…');

  try {
    // 状態表示を先に描画させる.
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    // canvasの文字は, フォントが未読み込みだと代替フォントで描かれる. 先に読み込んでおく.
    await loadFontsFor(objects);

    const keepResolution = $('keepOriginalResolution').checked;
    const quantize = $('quantizeEnabled').checked;
    const cropPx = cropPixels();
    const { w, h } = keepResolution
      ? { w: cropPx.w, h: cropPx.h }
      : getDimensions(cropPx.w, cropPx.h, Number($('maxSide').value));
    const size = sourceSize();
    const cropRect = {
      x: cropPx.x / size.w,
      y: cropPx.y / size.h,
      w: cropPx.w / size.w,
      h: cropPx.h / size.h,
    };
    const composite = buildCompositeCanvas(w, h, cropRect);
    const imageData = composite.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    // 合成用のcanvasは不要になったので, すぐにメモリを返す.
    composite.width = 0;
    composite.height = 0;
    const settings = readConversionSettings();
    const { buffer, paletteCount } = await runWorker(imageData, settings);

    // 変換中に編集された場合は, 古い内容の結果を表示・保存させない.
    if (version !== state.resultVersion) {
      setStatus('変換中に編集内容が変更されたため, 結果を破棄しました. もう一度変換してください');
      $('resultEmptyText').textContent = RESULT_EMPTY_TEXT;
      return false;
    }
    result.width = w;
    result.height = h;
    rctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), w, h), 0, 0);
    state.resultProbe = probeCanvas(result);
    state.converted = true;
    updateStageView();
    setStatus(
      `${quantize ? '変換' : '編集'}完了：${w} × ${h} px ／ ${settings.grayscale ? 'グレースケール' : 'カラー'}`
      + `${quantize ? ` ／ ${paletteCount} 色` : ' ／ 色数削減・ディザリングなし'}`
      + `${keepResolution ? ' ／ 元解像度' : ''}`,
    );
    return true;
  } catch (error) {
    console.error(error);
    setStatus('変換エラーです. 画像サイズを小さくして再試行してください');
    $('resultEmptyText').textContent = RESULT_EMPTY_TEXT;
    return false;
  } finally {
    state.converting = false;
    setConvertBusy(false);
  }
}

// 結果canvasを8x8に縮めた見本. 画面が裏に回っている間にcanvasが空になっていないかを, 変換時の見本と比べて調べる.
export function probeCanvas(source) {
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 8;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  probeCtx.drawImage(source, 0, 0, 8, 8);
  return probeCtx.getImageData(0, 0, 8, 8).data;
}

export const isBlankProbe = (data) => data.every((value) => value === 0);
