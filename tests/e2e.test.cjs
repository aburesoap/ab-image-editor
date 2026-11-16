// iMage Editor の画面を実際のブラウザ(Chromium)で動かして確かめるテスト.
// 実行: npm test (Node.js 20以降と, playwright パッケージが必要. README の「開発」を参照)
// 公開先の代わりに, ファイルを直接返す仮のサイト(https://app.test)として開く. 外部への通信は行わない.

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
// クリップボードなどは安全な接続(https)でしか使えないため, https で開く(公開先の GitHub Pages も https).
const ORIGIN = 'https://app.test';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png',
};
// 黄色の長方形(既定の塗り色)が見分けやすいよう, 真っ黒な画像を使う.
const IMAGE_W = 400;
const IMAGE_H = 300;
const DEFAULT_FILL = [0xf4, 0xc9, 0x5d];

// フォントの読み込み先(js/fonts.js).
const FONT_HOSTS = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//;

let browser;
let fontRequests;
let page;
let errors;
let tmpDir;

before(async () => {
  browser = await chromium.launch();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-editor-test-'));
});

after(async () => {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  page = await context.newPage();
  errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  // フォントは外部サイトから読み込む. テストでは通信させず, 読み込めない場合(端末内のフォントで表示)として動かす.
  // 読み込めなかったことを知らせるコンソールのエラーは, 意図どおりなので数えない.
  fontRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !FONT_HOSTS.test(message.location().url || '')) errors.push(message.text());
  });
  await page.route(FONT_HOSTS, (route) => {
    fontRequests.push(route.request().url());
    return route.abort();
  });
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await loadImage();
});

afterEach(async () => {
  assert.deepEqual(errors, [], 'ブラウザのコンソールにエラーが出ていないこと');
  await page.context().close();
});

// ---- 共通の操作 ----
// 真っ黒な画像. 向きを確かめられるよう, 左上の隅(50×50px)だけを赤くしている.
async function makeImage(w = IMAGE_W, h = IMAGE_H) {
  const base64 = await page.evaluate(([width, height]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 50, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [w, h]);
  return Buffer.from(base64, 'base64');
}

async function loadImage() {
  await page.setInputFiles('#file', { name: 'black.png', mimeType: 'image/png', buffer: await makeImage() });
  await page.waitForFunction(() => !document.getElementById('original').hidden);
}

// 画像上の位置(0〜1の割合)を, 画面上の座標へ換算する.
async function at(fx, fy) {
  const box = await page.locator('#original').boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drawRect(from, to) {
  await page.keyboard.press('r');
  const a = await at(...from);
  const b = await at(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function placeText(pos, content) {
  await page.keyboard.press('t');
  const p = await at(...pos);
  await page.mouse.click(p.x, p.y);
  await page.locator('#editTextContent').fill(content);
  await page.locator('#editTextContent').dispatchEvent('change');
  await page.locator('#editTextContent').blur();
}

const layerNames = () => page.$$eval('#layerList .layer-name', (els) => els.map((el) => el.textContent));
const layerClasses = () => page.$$eval('#layerList .layer-row', (els) => els.map((el) => el.className));
const selectedName = () => page.textContent('#selectedObjectName');
const objectCount = () => page.locator('#layerList .layer-row').count();
const status = () => page.textContent('#status');

// 仕上がり(書き出す画像)を作る. 色調整も減色も無いときは「仕上がり」の表示が無いため, 保存・コピーと同じ処理を直接呼ぶ.
async function makeResult() {
  await page.evaluate(async () => {
    const { convertImage } = await import(`${location.origin}/js/convert.js`);
    await convertImage();
  });
}

// 仕上がりの1画素を読む. 減色は既定でOFFなので, 合成した色がそのまま出る.
async function resultPixel(fx, fy) {
  await makeResult();
  return page.evaluate(([x, y]) => {
    const canvas = document.getElementById('result');
    const ctx = canvas.getContext('2d');
    return [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data.slice(0, 3)];
  }, [fx, fy]);
}

const near = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 2);

async function saveProjectToFile() {
  await page.click('#fileMenuSummary');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#saveProject')]);
  const file = path.join(tmpDir, `project-${Date.now()}.json`);
  await download.saveAs(file);
  return file;
}

// ---- テスト ----
test('画像を読み込むと, 道具と保存が使えるようになる', async () => {
  assert.match(await status(), /400 × 300 px/);
  assert.equal(await page.isDisabled('#download'), false);
  assert.equal(await page.isDisabled('#toolShape'), false);
});

test('置いた図形とテキストが, 前面を上にしてレイヤー一覧に並ぶ', async () => {
  assert.equal(await page.isVisible('#layerEmpty'), true);
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await placeText([0.6, 0.6], 'こんにちは');
  assert.deepEqual(await layerNames(), ['こんにちは', '長方形・塗り']);
  assert.equal(await page.textContent('#layerCount'), '2');
  assert.equal(await page.isVisible('#layerEmpty'), false);
});

test('一覧の行を押すと選択でき, つまみのドラッグで重ね順が変わる', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await placeText([0.6, 0.6], '前面');
  await page.locator('#layerList .layer-main').nth(1).click();
  assert.match(await selectedName(), /長方形（重ね順 1 \/ 2）/);

  const grip = await page.locator('#layerList .layer-grip').nth(1).boundingBox();
  const top = await page.locator('#layerList .layer-row').nth(0).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, top.y + 2, { steps: 6 });
  await page.mouse.up();
  assert.deepEqual(await layerNames(), ['長方形・塗り', '前面']);
  assert.match(await selectedName(), /重ね順 2 \/ 2/);

  // Alt+↓ で1つ後ろへ戻す.
  await page.locator('#layerList .layer-main').nth(0).press('Alt+ArrowDown');
  assert.deepEqual(await layerNames(), ['前面', '長方形・塗り']);
});

test('非表示にした図形は, 変換結果に描かれない', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  assert.ok(near(await resultPixel(0.35, 0.35), DEFAULT_FILL), '表示中は長方形の色になる');

  await page.click('#tabProps');
  await page.locator('#layerList [data-act=visible]').nth(0).click();
  assert.match((await layerClasses())[0], /is-hidden/);
  assert.ok(near(await resultPixel(0.35, 0.35), [0, 0, 0]), '非表示にすると背景の色になる');
});

test('ロック中は, プレビュー上で選べず, Delete でも消えない', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await page.locator('#layerList [data-act=lock]').nth(0).click();
  assert.equal(await page.isDisabled('#editX'), true);
  assert.equal(await page.isDisabled('#deleteObject'), true);

  await page.keyboard.press('Delete');
  assert.equal(await objectCount(), 1);
  assert.match(await status(), /ロック中のため削除できません/);

  await page.keyboard.press('Escape');
  const p = await at(0.35, 0.35);
  await page.mouse.click(p.x, p.y);
  assert.equal(await page.isVisible('#propBody'), false, 'プレビュー上では選べない');

  await page.locator('#layerList .layer-main').nth(0).click();
  assert.equal(await page.isVisible('#propBody'), true, '一覧からは選べる');
});

test('元に戻す・やり直すの後も, 同じオブジェクトを選んだままにする', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await drawRect([0.5, 0.5], [0.8, 0.8]);
  // 選択中の2つ目を動かしてから, 元に戻す.
  const from = await at(0.65, 0.65);
  const to = await at(0.7, 0.4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  assert.match(await selectedName(), /重ね順 2 \/ 2/);
  assert.equal(await page.inputValue('#editY'), '65');
  await page.keyboard.press('Control+y');
  assert.match(await selectedName(), /重ね順 2 \/ 2/);

  // 置いたこと自体を取り消した場合は, 選択が外れる.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await objectCount(), 1);
  assert.equal(await page.isVisible('#propBody'), false);
});

test('カラーピッカーで選んだ色が反映され, 元に戻せる', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await page.click('#editFill');
  assert.equal(await page.isVisible('#colorPopover'), true);
  await page.fill('#cpHex', '#12ab34');
  await page.press('#cpHex', 'Enter');
  assert.equal(await page.$eval('#editFill', (el) => el.value), '#12ab34');

  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#colorPopover'), false);
  assert.deepEqual(await page.$$eval('#cpRecent .cp-swatch', (els) => els.map((el) => el.dataset.color)), ['#12ab34']);

  // 3桁の省略形も受け付ける.
  await page.click('#editFill');
  await page.fill('#cpHex', 'f00');
  await page.press('#cpHex', 'Enter');
  assert.equal(await page.$eval('#editFill', (el) => el.value), '#ff0000');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+z');
  assert.equal(await page.$eval('#editFill', (el) => el.value), '#12ab34');
});

test('編集データを保存して読み込むと, 非表示・ロックも元に戻る', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await placeText([0.6, 0.6], '注釈');
  await page.locator('#layerList [data-act=visible]').nth(0).click();
  await page.locator('#layerList [data-act=lock]').nth(1).click();
  const before = await layerClasses();
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 5);

  // 「すべて消去」は, 何も選んでいないときに表示される.
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  assert.equal(await objectCount(), 0);
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('読み込みました'));
  assert.deepEqual(await layerNames(), ['注釈', '長方形・塗り']);
  assert.deepEqual((await layerClasses()).map((c) => c.replace(' selected', '')), before.map((c) => c.replace(' selected', '')));
});

test('新しい版で保存された編集データは, 読み込まずに案内を出す', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  const file = await saveProjectToFile();
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  project.version = 99;
  project.document.objects = [];
  fs.writeFileSync(file, JSON.stringify(project));
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('新しい版'));
  assert.equal(await objectCount(), 1, '今の編集内容はそのまま');
});

// ---- v1.5.0: 回転 ----
test('画像を右へ90°回すと, 図形と切り抜き範囲も一緒に回る', async () => {
  // 400×300 の画像で, (40,30)〜(120,60) px の長方形.
  await drawRect([0.1, 0.1], [0.3, 0.2]);
  await page.keyboard.press('c');
  await page.click('#rotateRight');
  assert.match(await status(), /300 × 400 px/);
  assert.equal(await page.$eval('#original', (el) => `${el.width}x${el.height}`), '300x400');

  // 右へ回すと, 左上の赤い隅は右上へ, 長方形は (240,40)〜(270,120) px へ移る.
  assert.ok(near(await resultPixel(290 / 300, 10 / 400), [255, 0, 0]), '赤い隅が右上にある');
  assert.ok(near(await resultPixel(10 / 300, 10 / 400), [0, 0, 0]), '左上は黒');
  assert.ok(near(await resultPixel(255 / 300, 80 / 400), DEFAULT_FILL), '長方形も一緒に回る');

  // 元に戻すと, 向きも戻る.
  await page.keyboard.press('Control+z');
  assert.equal(await page.$eval('#original', (el) => `${el.width}x${el.height}`), '400x300');
  assert.ok(near(await resultPixel(80 / 400, 45 / 300), DEFAULT_FILL));
});

test('三角形とテキストは, 角度が90°ずつ変わる. 左右に1回ずつ回すと元に戻る', async () => {
  await page.keyboard.press('r');
  await page.selectOption('#shapeType', 'triangle');
  const a = await at(0.1, 0.1);
  const b = await at(0.3, 0.4);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const before = await page.evaluate(() => ['editX', 'editY', 'editWidth', 'editHeight', 'editAngle'].map((id) => document.getElementById(id).value));

  await page.keyboard.press('c');
  await page.click('#rotateLeft');
  await page.keyboard.press('v');
  await page.locator('#layerList .layer-main').nth(0).click();
  assert.equal(await page.inputValue('#editAngle'), '-90');

  await page.keyboard.press('c');
  await page.click('#rotateRight');
  await page.keyboard.press('v');
  await page.locator('#layerList .layer-main').nth(0).click();
  const after = await page.evaluate(() => ['editX', 'editY', 'editWidth', 'editHeight', 'editAngle'].map((id) => document.getElementById(id).value));
  assert.deepEqual(after, before);
});

test('回転した向きは, 編集データに保存され, 読み込むと戻る', async () => {
  await page.keyboard.press('c');
  await page.click('#rotateRight');
  await page.click('#rotateRight');
  const file = await saveProjectToFile();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).document.rotation, 180);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('読み込みました'));
  assert.ok(near(await resultPixel(390 / 400, 290 / 300), [255, 0, 0]), '180°回すと, 赤い隅は右下');
});

// ---- v1.5.0: 拡大・移動 ----
const zoomText = () => page.textContent('#zoomLevel');
const imageFractionAt = async (x, y) => {
  const box = await page.locator('#original').boundingBox();
  return { x: (x - box.x) / box.width, y: (y - box.y) / box.height };
};

test('ボタンとショートカットで拡大縮小でき, 全体表示に戻せる', async () => {
  assert.equal(await page.getAttribute('#zoomFit', 'aria-pressed'), 'true');
  const fit = parseInt(await zoomText(), 10);
  await page.click('#zoomIn');
  assert.ok(parseInt(await zoomText(), 10) > fit);
  assert.equal(await page.getAttribute('#zoomFit', 'aria-pressed'), 'false');
  await page.click('#zoomLevel');
  assert.equal(await zoomText(), '100%');
  assert.equal((await page.locator('#original').boundingBox()).width, IMAGE_W);
  await page.keyboard.press('Control+0');
  assert.equal(parseInt(await zoomText(), 10), fit);
  await page.keyboard.press('Control+=');
  assert.ok(parseInt(await zoomText(), 10) > fit);
});

test('Ctrl+ホイールでは, カーソルの下の位置を保ったまま拡大する', async () => {
  const p = await at(0.3, 0.6);
  const before = await imageFractionAt(p.x, p.y);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.getElementById('zoomFit').getAttribute('aria-pressed') === 'false');
  const after = await imageFractionAt(p.x, p.y);
  assert.ok(Math.abs(after.x - before.x) < 0.005 && Math.abs(after.y - before.y) < 0.005);
});

test('拡大中は, スペース+ドラッグとホイールで表示位置を動かせ, 道具は正しい位置に置ける', async () => {
  await page.click('#zoomIn');
  await page.click('#zoomIn');
  const start = await page.locator('#original').boundingBox();
  const c = await page.locator('#stageCanvas').boundingBox();
  const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const moved = await page.locator('#original').boundingBox();
  assert.ok(Math.abs(moved.x - start.x - 60) < 2 && Math.abs(moved.y - start.y - 40) < 2, 'ドラッグした分だけ動く');
  assert.equal(await objectCount(), 0, 'スペース+ドラッグでは道具を使わない');

  await page.mouse.wheel(0, 50);
  const scrolled = await page.locator('#original').boundingBox();
  assert.ok(Math.abs(scrolled.y - (moved.y - 50)) < 2, 'ホイールで上下に動く');

  // 拡大・移動した状態で, 画面の中央にテキストを置く.
  const expected = await imageFractionAt(mid.x, mid.y);
  await page.keyboard.press('t');
  await page.mouse.click(mid.x, mid.y);
  assert.ok(Math.abs(Number(await page.inputValue('#editX')) - expected.x * 100) < 0.5);
  assert.ok(Math.abs(Number(await page.inputValue('#editY')) - expected.y * 100) < 0.5);
});

// ---- v1.5.0: ドロップ・貼り付け・コピー ----
async function sendFile(kind, buffer, name, type) {
  await page.evaluate(async ([how, bytes, fileName, mime]) => {
    const file = new File([new Uint8Array(bytes)], fileName, { type: mime });
    const data = new DataTransfer();
    data.items.add(file);
    if (how === 'paste') {
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    } else {
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));
      window.__overlay = !document.getElementById('dropOverlay').hidden;
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, [kind, [...buffer], name, type]);
}

test('画像をドロップすると開ける. 編集中なら確認を出し, 断れば今の内容を残す', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  const image = await makeImage(200, 100);
  page.once('dialog', (dialog) => dialog.dismiss());
  await sendFile('drop', image, 'small.png', 'image/png');
  assert.equal(await page.evaluate(() => window.__overlay), true, 'ドラッグ中は案内を表示する');
  assert.equal(await page.isVisible('#dropOverlay'), false);
  assert.equal(await objectCount(), 1);

  page.once('dialog', (dialog) => dialog.accept());
  await sendFile('drop', image, 'small.png', 'image/png');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('200 × 100'));
  assert.equal(await objectCount(), 0);
});

test('編集データ(.json)をドロップすると, 編集データとして読み込む', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  const file = await saveProjectToFile();
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  await sendFile('drop', fs.readFileSync(file), 'project.json', 'application/json');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('読み込みました'));
  assert.equal(await objectCount(), 1);
});

test('Ctrl+V で画像を貼り付けて開ける. 文字の入力欄への貼り付けは邪魔しない', async () => {
  await sendFile('paste', await makeImage(120, 80), 'image.png', 'image/png');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('貼り付け完了'));
  assert.match(await status(), /120 × 80 px/);

  await placeText([0.5, 0.5], 'abc');
  await page.focus('#editTextContent');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    document.getElementById('editTextContent').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  assert.equal(await objectCount(), 1, '入力欄への貼り付けでは, 画像を開き直さない');
});

test('「コピー」で, 仕上がりの画像がPNGとしてクリップボードに入る', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await page.click('#copyImage');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('コピーしました'));
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('image/png');
    const bitmap = await createImageBitmap(blob);
    return { w: bitmap.width, h: bitmap.height, types: item.types };
  });
  assert.deepEqual(copied.types, ['image/png']);
  assert.equal(`${copied.w}x${copied.h}`, '400x300');
});

// ---- v1.5.1 ----
test('減色・ディザリングは既定でOFFで, 書き出しタブの詳細設定に入っている', async () => {
  await page.click('#tabFinish');
  assert.equal(await page.textContent('#tabFinish'), '書き出し');
  assert.equal(await page.isVisible('#exportName'), true);
  assert.equal(await page.isVisible('#quantizeEnabled'), false, '詳細設定は閉じている');
  await page.click('#advancedSettings > summary');
  assert.equal(await page.isChecked('#quantizeEnabled'), false);
  assert.equal(await page.isDisabled('#colors'), true);
  await page.check('#quantizeEnabled');
  assert.equal(await page.isDisabled('#colors'), false);
  await page.click('#reset');
  assert.equal(await page.isChecked('#quantizeEnabled'), false, 'リセットでOFFに戻る');
});

test('レイヤー一覧の ▲▼ で, 重ね順を1つずつ動かせる. 端では押せない', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await placeText([0.6, 0.6], '前面');
  assert.deepEqual(await layerNames(), ['前面', '長方形・塗り']);
  const up = page.locator('#layerList [data-act=up]');
  const down = page.locator('#layerList [data-act=down]');
  assert.equal(await up.nth(0).isDisabled(), true, '最前面の▲は押せない');
  assert.equal(await down.nth(1).isDisabled(), true, '最背面の▼は押せない');
  await down.nth(0).click();
  assert.deepEqual(await layerNames(), ['長方形・塗り', '前面']);
  await up.nth(1).click();
  assert.deepEqual(await layerNames(), ['前面', '長方形・塗り']);
  assert.equal(await page.locator('#bringForward').count(), 0, 'パネルの「ひとつ前へ」は無くなった');
});

test('切り抜き範囲は, 図形と同じ8か所のハンドルで, どの辺からでも変えられる', async () => {
  await page.keyboard.press('c');
  // 左辺の中央のハンドルを, 画像の幅の1/4だけ右へ.
  const from = await at(0, 0.5);
  const to = await at(0.25, 0.5);
  await page.mouse.move(from.x + 1, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x + 1, to.y, { steps: 5 });
  await page.mouse.up();
  // 上辺の中央のハンドルを, 高さの1/3だけ下へ.
  const a = await at(0.625, 0);
  const b = await at(0.625, 1 / 3);
  await page.mouse.move(a.x, a.y + 1);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + 1, { steps: 5 });
  await page.mouse.up();
  await makeResult();
  const size = await page.$eval('#result', (el) => [el.width, el.height]);
  assert.ok(Math.abs(size[0] - 300) <= 2 && Math.abs(size[1] - 200) <= 2, `仕上がりは約300×200px (実際: ${size})`);
});

// ---- v2.0.0（Web 版） ----
test('ファビコンが設定され, アイコンの画像を読み込める', async () => {
  const icons = await page.$$eval('link[rel="icon"], link[rel="apple-touch-icon"]', (links) => links.map((link) => link.getAttribute('href')));
  assert.deepEqual(icons, ['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png', 'icons/icon128.png']);
  const sizes = await page.evaluate(async (hrefs) => Promise.all(hrefs.map(async (href) => {
    const response = await fetch(href);
    const bitmap = await createImageBitmap(await response.blob());
    return `${response.status} ${bitmap.width}x${bitmap.height}`;
  })), icons.slice(0, 3));
  assert.deepEqual(sizes, ['200 16x16', '200 48x48', '200 128x128']);
});

test('CSP は外部サイトの画像とフォントを許可し, 外部のスクリプトは許可しない', async () => {
  const EXTERNAL = 'https://external.test';
  const png = await makeImage(8, 8);
  let fontRequested = false;
  await page.route(`${EXTERNAL}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    if (url.endsWith('.woff2')) {
      // フォントは同梱していないので, 中身は空で返す. CSP で止められずに, 取りに行けることだけを確かめる.
      fontRequested = true;
      return route.fulfill({ status: 200, contentType: 'font/woff2', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__externalScript = true;' });
  });
  const result = await page.evaluate(async (origin) => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', (event) => violations.push(event.violatedDirective));
    const image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
      img.onerror = () => resolve('error');
      img.src = `${origin}/sample.png`;
    });
    await new FontFace('ExternalTest', `url(${origin}/sample.woff2)`).load().catch(() => {});
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.onload = resolve;
      script.onerror = resolve;
      script.src = `${origin}/sample.js`;
      document.head.append(script);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { image, script: window.__externalScript === true, violations };
  }, EXTERNAL);
  assert.equal(result.image, '8x8', '外部の画像は読み込める');
  assert.equal(fontRequested, true, '外部のフォントを取りに行ける');
  assert.equal(result.violations.some((directive) => directive.startsWith('font-src')), false, 'フォントは CSP で止められない');
  assert.equal(result.script, false, '外部のスクリプトは実行されない');
  assert.ok(result.violations.some((directive) => directive.startsWith('script-src')), 'スクリプトは CSP で止められる');
  // 外部のスクリプトを止めたときのコンソールのエラーは, 意図どおりなので除く.
  errors = errors.filter((message) => !message.includes('Content Security Policy'));
});

// ---- v2.1.0 ----
// 仕上がりの複数の画素を読む. 位置は画像上の割合(0〜1).
async function resultPixels(points) {
  await makeResult();
  return page.evaluate((list) => {
    const canvas = document.getElementById('result');
    const ctx = canvas.getContext('2d');
    return list.map(([x, y]) => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data.slice(0, 3)]);
  }, points);
}

async function drawShapeOf(type, from, to) {
  await page.keyboard.press('r');
  await page.selectOption('#shapeType', type);
  const a = await at(...from);
  const b = await at(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function setRange(id, value) {
  await page.$eval(`#${id}`, (el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

const BLACK = [0, 0, 0];

test('画面に版の番号を表示しない', async () => {
  assert.equal(await page.locator('.ver').count(), 0);
  assert.doesNotMatch(await page.textContent('.topbar'), /v\d+\.\d+/);
});

// 枠(0.2, 0.2)〜(0.8, 0.8)に描いたときの, 塗られる位置と塗られない位置(枠の中の割合).
const SHAPE_CASES = [
  ['roundrect', '角丸長方形', [[0.5, 0.5], [0.05, 0.5], [0.5, 0.95]], [[0.01, 0.01], [0.99, 0.99]]],
  ['diamond', 'ひし形', [[0.5, 0.5], [0.5, 0.1], [0.9, 0.5]], [[0.1, 0.1], [0.9, 0.9]]],
  ['star', '星', [[0.5, 0.5], [0.5, 0.1], [0.25, 0.4]], [[0.1, 0.1], [0.5, 0.9], [0.9, 0.9]]],
  ['balloon', '吹き出し', [[0.5, 0.4], [0.23, 0.9]], [[0.8, 0.9], [0.05, 0.95]]],
  ['blockarrow', '太矢印', [[0.1, 0.5], [0.5, 0.5], [0.7, 0.2], [0.95, 0.5]], [[0.3, 0.1], [0.3, 0.9], [0.9, 0.1]]],
];
for (const [type, label, inside, outside] of SHAPE_CASES) {
  test(`図形「${label}」を描ける. 内側は塗られ, 形の外は塗られない`, async () => {
    await drawShapeOf(type, [0.2, 0.2], [0.8, 0.8]);
    assert.deepEqual(await layerNames(), [`${label}・塗り`]);
    const toImage = ([x, y]) => [0.2 + x * 0.6, 0.2 + y * 0.6];
    const pixels = await resultPixels([...inside, ...outside].map(toImage));
    pixels.slice(0, inside.length).forEach((pixel, i) => assert.ok(near(pixel, DEFAULT_FILL), `${inside[i]} は塗られる (実際: ${pixel})`));
    pixels.slice(inside.length).forEach((pixel, i) => assert.ok(near(pixel, BLACK), `${outside[i]} は塗られない (実際: ${pixel})`));
  });
}

test('矢印の線は, 矢じりの先から突き出さない. 半透明でも重なりが濃くならない', async () => {
  // 白い矢印を, 画像の左から右へ(先端は x = 280px).
  await drawShapeOf('arrow', [0.2, 0.5], [0.7, 0.5]);
  await setRange('editLineWidth', 30);
  await setRange('editOpacity', 50);
  const xs = [];
  for (let x = 120; x <= 274; x += 2) xs.push(x);
  const beyond = [283, 286, 290, 295];
  const pixels = await resultPixels([...xs, ...beyond].map((x) => [(x + 0.5) / 400, 150.5 / 300]));
  const axis = pixels.slice(0, xs.length);
  // 軸の上は, 軸の部分も矢じりの部分も, 白の50%(約128)で同じ濃さ.
  axis.forEach((pixel, i) => assert.ok(Math.abs(pixel[0] - 128) <= 3, `x = ${xs[i]}px は半透明の白 (実際: ${pixel})`));
  pixels.slice(xs.length).forEach((pixel, i) => assert.ok(near(pixel, BLACK), `先端より先(x = ${beyond[i]}px)は何も描かれない (実際: ${pixel})`));
});

test('両矢印は, 両端に矢じりが付く', async () => {
  await drawShapeOf('arrow2', [0.2, 0.5], [0.8, 0.5]);
  assert.deepEqual(await layerNames(), ['両矢印']);
  await setRange('editLineWidth', 4);
  // 線(太さ4px)より外側でも, 両端の近く(先端から12px)は矢じり(長さ16px)で塗られている.
  const pixels = await resultPixels([[92.5 / 400, 155.5 / 300], [307.5 / 400, 155.5 / 300], [200.5 / 400, 155.5 / 300]]);
  assert.ok(pixels[0][0] > 200, `左端に矢じり (実際: ${pixels[0]})`);
  assert.ok(pixels[1][0] > 200, `右端に矢じり (実際: ${pixels[1]})`);
  assert.ok(near(pixels[2], BLACK), `中ほどは線の太さだけ (実際: ${pixels[2]})`);
});

test('星・吹き出し・太矢印は, 画像と一緒に回すと角度が90°変わる. ひし形は変わらない', async () => {
  await drawShapeOf('star', [0.1, 0.1], [0.3, 0.4]);
  await page.keyboard.press('Escape');
  await drawShapeOf('diamond', [0.5, 0.5], [0.7, 0.8]);
  await page.keyboard.press('c');
  await page.click('#rotateRight');
  await page.keyboard.press('v');
  const angleOf = async (row) => {
    await page.locator('#layerList .layer-main').nth(row).click();
    return page.inputValue('#editAngle');
  };
  assert.equal(await angleOf(1), '90', '星');
  assert.equal(await angleOf(0), '0', 'ひし形');
});

test('新しい図形は, 編集データ(形式 v5)に保存され, 読み込むと戻る', async () => {
  await drawShapeOf('balloon', [0.1, 0.1], [0.4, 0.4]);
  await page.keyboard.press('Escape');
  await drawShapeOf('arrow2', [0.5, 0.5], [0.9, 0.9]);
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 5);
  assert.deepEqual(saved.document.objects.map((obj) => obj.type), ['balloon', 'arrow2']);
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  assert.equal(await objectCount(), 0);
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.deepEqual(await layerNames(), ['両矢印', '吹き出し・塗り']);
});

test('貼り付けボタンで, クリップボードの画像を開ける', async () => {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    canvas.getContext('2d').fillRect(0, 0, 120, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.click('#pasteImage');
  await page.waitForFunction(() => document.getElementById('original').width === 120);
  assert.match(await status(), /貼り付け完了：120 × 80 px/);
});

test('貼り付けボタンは, クリップボードに画像が無ければ案内を出す', async () => {
  await page.evaluate(() => navigator.clipboard.writeText('文字だけ'));
  await page.click('#pasteImage');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('クリップボードに画像がありません'));
  assert.equal(await page.$eval('#original', (el) => el.width), 400, '画像はそのまま');
});

// ---- v2.1.1 ----
test('レイヤー一覧のごみ箱で, その行だけを消せる. 選択は別のオブジェクトに付いたまま', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.keyboard.press('Escape');
  await placeText([0.6, 0.6], '残す');
  await page.keyboard.press('Escape');
  await drawShapeOf('star', [0.5, 0.1], [0.7, 0.3]);
  // 一覧は前面が上: 星, テキスト, 長方形. テキストを選んだまま, 星を消す.
  await page.locator('#layerList .layer-main').nth(1).click();
  await page.locator('#layerList [data-act=delete]').nth(0).click();
  assert.deepEqual(await layerNames(), ['残す', '長方形・塗り']);
  assert.match(await selectedName(), /テキスト/);
  // 選んでいるものを消すと, 選択が外れる.
  await page.locator('#layerList [data-act=delete]').nth(0).click();
  assert.deepEqual(await layerNames(), ['長方形・塗り']);
  assert.equal(await page.isVisible('#propBody'), false);
  // 元に戻せる.
  await page.keyboard.press('Control+z');
  assert.deepEqual(await layerNames(), ['残す', '長方形・塗り']);
});

test('ロック中の行は, ごみ箱を押せない', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.locator('#layerList [data-act=lock]').nth(0).click();
  assert.equal(await page.locator('#layerList [data-act=delete]').nth(0).isDisabled(), true);
  await page.locator('#layerList [data-act=lock]').nth(0).click();
  assert.equal(await page.locator('#layerList [data-act=delete]').nth(0).isDisabled(), false);
});

test('色調整も減色も無ければ「編集 / 仕上がり」の切り替えを出さず, 使うと出る', async () => {
  assert.equal(await page.isVisible('#viewSwitch'), false);
  await page.click('#tabFinish');
  assert.equal(await page.isVisible('#showResult'), false);
  await setRange('brightness', 40);
  assert.equal(await page.isVisible('#viewSwitch'), true);
  assert.equal(await page.isVisible('#showResult'), true);
  // 仕上がりを表示したまま色調整を戻すと, 編集の表示へ戻る.
  await page.click('#viewResult');
  await page.waitForFunction(() => !document.getElementById('result').hidden);
  await setRange('brightness', 0);
  assert.equal(await page.isVisible('#viewSwitch'), false);
  assert.equal(await page.isVisible('#original'), true);
  // 減色でも出る.
  await page.click('#advancedSettings > summary');
  await page.check('#quantizeEnabled');
  assert.equal(await page.isVisible('#viewSwitch'), true);
});

test('色調整が無ければ, 切り替えを通さずにそのまま保存でき, 図形も書き出される', async () => {
  await drawRect([0.25, 0.25], [0.75, 0.75]);
  // 保存先を選ぶ画面はテストでは操作できないため, ダウンロードとして保存させる.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const file = path.join(tmpDir, `direct-${Date.now()}.png`);
  await download.saveAs(file);
  const pixels = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { size: `${bitmap.width}x${bitmap.height}`, inside: at(200, 150), outside: at(380, 280), corner: at(10, 10) };
  }, fs.readFileSync(file).toString('base64'));
  assert.equal(pixels.size, '400x300');
  assert.ok(near(pixels.inside, DEFAULT_FILL), `図形 (実際: ${pixels.inside})`);
  assert.ok(near(pixels.outside, BLACK), `図形の外 (実際: ${pixels.outside})`);
  assert.ok(near(pixels.corner, [255, 0, 0]), `元画像の左上 (実際: ${pixels.corner})`);
});

test('明るさを変えた仕上がりは, 編集中の見た目より明るくなる', async () => {
  await setRange('brightness', 40);
  assert.ok(near(await resultPixel(0.9, 0.9), [40, 40, 40]));
});

test('フォントは外部から読み込み, 選択肢はフォントの一覧から作る. 読み込めなくてもテキストを描ける', async () => {
  // 起動時に, 画面用のフォントの読み込みを始めている(テストでは通信を止めている).
  assert.ok(fontRequests.some((url) => url.startsWith('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP')), 'IBM Plex Sans JP');
  assert.equal(await page.locator('link[rel=stylesheet][data-font=plex]').count(), 1);
  const registry = await page.evaluate(async () => {
    const fonts = await import(`${location.origin}/js/fonts.js`);
    return { keys: fonts.FONT_KEYS, labels: fonts.FONT_KEYS.map((key) => fonts.TEXT_FONTS[key].label), https: fonts.FONT_KEYS.every((key) => {
      const font = fonts.TEXT_FONTS[key];
      return [font.css, ...Object.values(font.files || {})].filter(Boolean).every((url) => url.startsWith('https://'));
    }) };
  });
  assert.equal(registry.https, true, '読み込み先は https だけ');

  await placeText([0.5, 0.5], '注釈');
  assert.deepEqual(await page.$$eval('#editTextFont option', (els) => els.map((el) => [el.value, el.textContent])), registry.keys.map((key, i) => [key, registry.labels[i]]));
  // 太さが1つしか無いフォントでは, 太さを選べない. 戻すと選べる.
  await page.selectOption('#editTextFont', 'udev');
  assert.equal(await page.isDisabled('#editTextWeight'), true);
  assert.equal(await page.inputValue('#editTextWeight'), '400');
  await page.selectOption('#editTextFont', 'plex');
  assert.equal(await page.isDisabled('#editTextWeight'), false);
  // フォントを読み込めなくても, 端末内のフォントで文字が描かれる(背景色の箱が出る).
  assert.ok(near(await resultPixel(0.5, 0.42), [0x20, 0x20, 0x20]) || near(await resultPixel(0.5, 0.45), [0x20, 0x20, 0x20]), 'テキストの背景');
});

test('図形とテキストを別々に持つ古い形式の編集データは, 読み込まずに案内を出す', async () => {
  const file = path.join(tmpDir, `legacy-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    format: 'iMage-Editor-project', version: 1, source: { width: IMAGE_W, height: IMAGE_H },
    document: { crop: { x: 0, y: 0, w: 1, h: 1 }, shapes: [], text: { content: '古い' } },
    conversion: {},
  }));
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込めませんでした'));
  assert.equal(await objectCount(), 0);
});
