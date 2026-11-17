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

async function saveProjectToFile(button = '#saveProject') {
  await page.click('#fileMenuSummary');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
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
  assert.equal(saved.version, 10);

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

test('新しい図形は, 編集データに保存され, 読み込むと戻る', async () => {
  await drawShapeOf('balloon', [0.1, 0.1], [0.4, 0.4]);
  await page.keyboard.press('Escape');
  await drawShapeOf('arrow2', [0.5, 0.5], [0.9, 0.9]);
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
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

// ---- v2.2.0 ----
// 仕上がりの1行(y)のうち, 指定した x の画素を読む. 位置は px.
async function resultRow(xs, y) {
  return resultPixels(xs.map((x) => [(x + 0.5) / 400, (y + 0.5) / 300]));
}

test('スポイトのボタンは無い', async () => {
  await drawRect([0.1, 0.1], [0.3, 0.3]);
  await page.click('#editFill');
  assert.equal(await page.isVisible('#colorPopover'), true);
  assert.equal(await page.locator('#cpEyedropper').count(), 0);
});

test('モザイクは, 範囲の中を「強さ」の大きさのマスで塗り分ける. 範囲の外は変わらない', async () => {
  // 左上の赤い四角(0〜50px)にかかるよう, 0〜100px の範囲にモザイク. 1マス40px.
  await drawShapeOf('mosaic', [0, 0], [0.25, 1 / 3]);
  assert.deepEqual(await layerNames(), ['モザイク']);
  await setRange('editStrength', 40);
  const [a, b, c, d, outside] = await resultRow([5, 35, 45, 75, 150], 20);
  assert.deepEqual(a, b, '同じマスの中は同じ色');
  assert.deepEqual(c, d, '同じマスの中は同じ色');
  assert.ok(a[0] > 200, `赤だけのマスは赤 (実際: ${a})`);
  assert.ok(c[0] > 20 && c[0] < 120, `赤が一部だけのマスは, 暗い赤 (実際: ${c})`);
  assert.ok(near(outside, BLACK), `範囲の外は黒のまま (実際: ${outside})`);
});

test('ぼかしは, 範囲の中だけをにじませる', async () => {
  await drawShapeOf('blur', [0, 0], [0.25, 1 / 3]);
  await setRange('editStrength', 10);
  // 赤い四角の右の縁(x = 50px)の外側は, にじんで少し赤くなる. 範囲の外(x = 150px)は黒のまま.
  const [edge, inside, outside] = await resultRow([54, 20, 150], 25);
  assert.ok(edge[0] > 20 && edge[0] < 230, `縁はにじむ (実際: ${edge})`);
  assert.ok(inside[0] > 200, `赤の中ほどは赤 (実際: ${inside})`);
  assert.ok(near(outside, BLACK), `範囲の外 (実際: ${outside})`);
});

test('ぼかし・モザイクは背面のものだけを隠し, 前面の図形はそのまま描く', async () => {
  await drawShapeOf('mosaic', [0.1, 0.1], [0.9, 0.9]);
  await setRange('editStrength', 60);
  await page.keyboard.press('Escape');
  await drawShapeOf('rect', [0.4, 0.4], [0.6, 0.6]);
  assert.ok(near(await resultPixel(0.5, 0.5), DEFAULT_FILL));
  // 色・描画方法の欄は出さず, 強さの欄だけを出す.
  await page.locator('#layerList .layer-main').nth(1).click();
  assert.equal(await page.isVisible('#effectFields'), true);
  assert.equal(await page.isVisible('#shapeFields'), false);
});

test('番号はクリックで置け, 置くたびに1つずつ増える. 番号は変えられ, 次はその続きになる', async () => {
  await page.keyboard.press('r');
  await page.selectOption('#shapeType', 'badge');
  assert.match(await page.textContent('#toolHint'), /クリックで番号を配置/);
  await page.check('#toolLock');
  for (const [fx, fy] of [[0.3, 0.5], [0.5, 0.5]]) {
    const p = await at(fx, fy);
    await page.mouse.click(p.x, p.y);
  }
  assert.deepEqual(await layerNames(), ['番号 2', '番号 1']);
  // 丸の色は既定で赤. 数字(白)から外れた丸の中を読む(直径28px).
  const [ring] = await resultRow([0.3 * 400 - 10], 150);
  assert.ok(near(ring, [0xd8, 0x3b, 0x3b]), `丸の色 (実際: ${ring})`);
  const [digit] = await resultRow([0.3 * 400], 150);
  assert.ok(digit[1] > 120, `中央には白い数字 (実際: ${digit})`);

  await page.keyboard.press('v');
  await page.locator('#layerList .layer-main').nth(0).click();
  assert.equal(await page.isVisible('#badgeFields'), true);
  assert.equal(await page.textContent('#editFillLabel'), '丸の色');
  await page.fill('#editBadgeNumber', '7');
  await page.locator('#editBadgeNumber').dispatchEvent('change');
  assert.deepEqual(await layerNames(), ['番号 7', '番号 1']);
  await page.click('#duplicateObject');
  assert.deepEqual(await layerNames(), ['番号 8', '番号 7', '番号 1']);
});

test('テキストに縁取りを付けられる. 縁取りの分だけ枠が広がる', async () => {
  await placeText([0.5, 0.5], 'ABC');
  await page.check('#editTextTransparent');
  const widthBefore = await page.$eval('#editTextOutlineWidthVal', (el) => el.textContent);
  assert.equal(widthBefore, 'なし');
  const redCount = async () => {
    await makeResult();
    return page.evaluate(() => {
      const canvas = document.getElementById('result');
      const data = canvas.getContext('2d').getImageData(100, 0, 300, 300).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) count += 1;
      return count;
    });
  };
  assert.equal(await redCount(), 0);
  await page.click('#editTextOutline');
  await page.fill('#cpHex', 'ff0000');
  await page.press('#cpHex', 'Enter');
  await page.keyboard.press('Escape');
  await setRange('editTextOutlineWidth', 4);
  assert.equal(await page.textContent('#editTextOutlineWidthVal'), '4 px');
  assert.ok(await redCount() > 50, '赤い縁取りが描かれる');
});

test('番号・ぼかし・縁取りは, 編集データに保存され, 読み込むと戻る', async () => {
  await drawShapeOf('blur', [0.1, 0.1], [0.3, 0.3]);
  await setRange('editStrength', 20);
  await page.keyboard.press('Escape');
  await drawShapeOf('badge', [0.6, 0.6], [0.7, 0.7]);
  await page.keyboard.press('Escape');
  await placeText([0.5, 0.2], '縁');
  await setRange('editTextOutlineWidth', 3);
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
  const [blur, badge, text] = saved.document.objects;
  assert.equal(Math.round(blur.strength * 400), 20);
  assert.equal(badge.number, 1);
  assert.equal(Math.round(text.outlineWidth * 400), 3);
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.deepEqual(await layerNames(), ['縁', '番号 1', 'ぼかし']);
  await page.locator('#layerList .layer-main').nth(0).click();
  assert.equal(await page.inputValue('#editTextOutlineWidth'), '3');
  await page.locator('#layerList .layer-main').nth(2).click();
  assert.equal(await page.inputValue('#editStrength'), '20');
});

// ---- v2.3.0 ----
// スライダーをドラッグしたときと同じく, input だけを続けて送る(change は最後に1回).
async function dragRange(id, values) {
  await page.$eval(`#${id}`, (el, list) => {
    list.forEach((v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, values);
}

test('スライダーを動かして元の値へ戻すと, 元の値が反映される(縁取りが残らない)', async () => {
  await placeText([0.5, 0.5], 'ABC');
  await page.check('#editTextTransparent');
  await dragRange('editTextOutlineWidth', [1, 2, 3, 4, 3, 2, 1, 0]);
  const width = await page.evaluate(async () => (await import(`${location.origin}/js/state.js`)).objects[0].outlineWidth);
  assert.equal(width, 0);
  await dragRange('editOpacity', [90, 80, 90, 100]);
  const opacity = await page.evaluate(async () => (await import(`${location.origin}/js/state.js`)).objects[0].opacity);
  assert.equal(opacity, 1);
});

test('フォントは IBM Plex Sans JP だけ. 消したフォント(UDEV Gothic)の編集データは, IBM Plex Sans JP で読み込む', async () => {
  assert.deepEqual(await page.$$eval('#editTextFont option', (els) => els.map((el) => el.value)), ['plex']);
  assert.equal(fontRequests.some((url) => /udev/i.test(url)), false, 'UDEV Gothic は読み込まない');
  const file = path.join(tmpDir, `udev-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    format: 'iMage-Editor-project', version: 5, source: { width: IMAGE_W, height: IMAGE_H },
    document: { crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, objects: [{ type: 'text', content: '等幅', font: 'udev', weight: 400, size: 0.06, x: 0.5, y: 0.5 }] },
    conversion: {},
  }));
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  await page.locator('#layerList .layer-main').nth(0).click();
  assert.equal(await page.inputValue('#editTextFont'), 'plex');
  assert.equal(await page.inputValue('#editTextWeight'), '400');
});

// ペンで, 画像上の位置(割合)の点の列をなぞる. shift なら Shift を押しながら.
async function drawPen(points, shift = false) {
  await page.keyboard.press('p');
  const list = await Promise.all(points.map((pt) => at(...pt)));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(list[0].x, list[0].y);
  await page.mouse.down();
  for (const p of list.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test('ペンで描いた線は, なぞった所に描かれ, ペンの道具のまま続けて描ける', async () => {
  await drawPen([[0.2, 0.5], [0.5, 0.5], [0.5, 0.8]]);
  await drawPen([[0.7, 0.2], [0.9, 0.3]]);
  assert.deepEqual(await layerNames(), ['ペン', 'ペン']);
  assert.equal(await page.getAttribute('#toolPen', 'aria-pressed'), 'true', 'ペンの道具のまま');
  const [onLine, corner, offLine] = await resultPixels([[0.35, 0.5], [0.5, 0.65], [0.35, 0.65]]);
  assert.ok(near(onLine, [0xd8, 0x3b, 0x3b]), `線の上 (実際: ${onLine})`);
  assert.ok(near(corner, [0xd8, 0x3b, 0x3b]), `折れた先の線の上 (実際: ${corner})`);
  assert.ok(near(offLine, BLACK), `線の外 (実際: ${offLine})`);
  // 選択の道具で, 線の上を押すと選べる. 線から離れた枠の内側では選ばない.
  await page.keyboard.press('v');
  const off = await at(0.3, 0.7);
  await page.mouse.click(off.x, off.y);
  assert.equal(await page.isVisible('#propBody'), false, '線の外では選ばない');
  const on = await at(0.35, 0.5);
  await page.mouse.click(on.x, on.y);
  assert.match(await selectedName(), /ペン/);
  assert.equal(await page.isVisible('#fillField'), false, 'ペンには塗り色が無い');
});

test('Shift を押しながら描くと直線になる', async () => {
  await drawPen([[0.2, 0.3], [0.4, 0.6], [0.6, 0.3]], true);
  // 書き始めと終わりを結ぶ直線(y = 0.3)の上は描かれ, 途中で通った点(0.4, 0.6)は描かれない.
  const [mid, detour] = await resultPixels([[0.4, 0.3], [0.4, 0.6]]);
  assert.ok(near(mid, [0xd8, 0x3b, 0x3b]), `直線の上 (実際: ${mid})`);
  assert.ok(near(detour, BLACK), `途中の点 (実際: ${detour})`);
});

// 図形の道具で, Shift を押しながらドラッグする.
async function drawShapeShift(type, from, to) {
  await page.keyboard.press('r');
  await page.selectOption('#shapeType', type);
  const a = await at(...from);
  const b = await at(...to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

// 最後に置いたオブジェクトの枠を, 画像上の画素で読む.
const lastFramePx = () => page.evaluate(async ([w, h]) => {
  const { objects } = await import(`${location.origin}/js/state.js`);
  const obj = objects[objects.length - 1];
  return [obj.x1 * w, obj.y1 * h, obj.x2 * w, obj.y2 * h].map((v) => Math.round(v));
}, [IMAGE_W, IMAGE_H]);

test('Shift を押しながら図形を描くと, 画面上の正方形になる. 画像の端では正方形のまま縮める', async () => {
  // 横120px・縦60pxのドラッグ → 長い方に合わせて120px四方.
  await drawShapeShift('rect', [0.2, 0.2], [0.5, 0.4]);
  assert.deepEqual(await lastFramePx(), [80, 60, 200, 180]);
  await page.keyboard.press('Escape');
  // 左上へ向かうドラッグでも, 書き始めの点を角にする.
  await drawShapeShift('ellipse', [0.5, 0.8], [0.4, 0.5]);
  assert.deepEqual(await lastFramePx(), [200, 240, 110, 150]);
  await page.keyboard.press('Escape');
  // 右端まで120pxしか無いため, 縦も120pxに縮める.
  await drawShapeShift('rect', [0.7, 0.5], [0.99, 0.99]);
  assert.deepEqual(await lastFramePx(), [280, 150, 400, 270]);
  await page.keyboard.press('Escape');
  // ぼかしの範囲も正方形にする.
  await drawShapeShift('blur', [0.1, 0.1], [0.2, 0.3]);
  assert.deepEqual(await lastFramePx(), [40, 30, 100, 90]);
});

test('Shift を押しながら線・矢印を描くと, 45°刻みの向きになる', async () => {
  // ほぼ水平 → 水平.
  await drawShapeShift('line', [0.2, 0.5], [0.6, 0.55]);
  assert.deepEqual(await lastFramePx(), [80, 150, 240, 150]);
  await page.keyboard.press('Escape');
  // 斜め(横120px・縦126px) → 45°. 長さは, 45°の向きへ写した長さ.
  await drawShapeShift('arrow', [0.2, 0.2], [0.5, 0.62]);
  const [x1, y1, x2, y2] = await lastFramePx();
  assert.deepEqual([x1, y1], [80, 60]);
  assert.equal(x2 - x1, y2 - y1, '縦横が同じ長さ');
  assert.ok(Math.abs(x2 - x1 - 123) <= 1, `長さ (実際: ${x2 - x1})`);
  await page.keyboard.press('Escape');
  // ほぼ垂直 → 垂直.
  await drawShapeShift('line', [0.5, 0.1], [0.52, 0.6]);
  const vertical = await lastFramePx();
  assert.equal(vertical[0], vertical[2], '縦の線');
});

test('Shift を押しながらペンで描く直線も, 45°刻みの向きになる', async () => {
  // 終わりの点は書き始めより少し下だが, 水平の線にする.
  await drawPen([[0.2, 0.3], [0.5, 0.33]], true);
  const [onLine, below] = await resultPixels([[0.49, 0.3], [0.49, 0.33]]);
  assert.ok(near(onLine, [0xd8, 0x3b, 0x3b]), `水平の線の上 (実際: ${onLine})`);
  assert.ok(near(below, BLACK), `指の位置へ向かう斜めの線は描かない (実際: ${below})`);
});

test('白地を足すと画像全体が白くなり, 上に描いた線はそのまま. 白地は作業領域では選ばない', async () => {
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  await page.click('#addPaper');
  assert.deepEqual(await layerNames(), ['ペン', '白地'], '白地はいちばん下');
  assert.equal(await page.isVisible('#numericFields'), false, '白地には位置・大きさの欄が無い');
  const [paper, line, corner] = await resultPixels([[0.5, 0.2], [0.5, 0.5], [0.05, 0.05]]);
  assert.ok(near(paper, [255, 255, 255]), `白地 (実際: ${paper})`);
  assert.ok(near(corner, [255, 255, 255]), `元画像の赤い隅も覆う (実際: ${corner})`);
  assert.ok(near(line, [0xd8, 0x3b, 0x3b]), `線 (実際: ${line})`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const p = await at(0.5, 0.2);
  await page.mouse.click(p.x, p.y);
  assert.equal(await page.isVisible('#propBody'), false);
});

test('蛍光ペンは下の色と掛け合わせて描く(白の上は色が付き, 黒の上は黒のまま)', async () => {
  await page.click('#addPaper');
  await page.keyboard.press('Escape');
  await drawRect([0.45, 0.1], [0.55, 0.9]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await page.selectOption('#penType', 'marker');
  assert.equal(await page.inputValue('#penWidth'), '18');
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  assert.deepEqual((await layerNames())[0], '蛍光ペン');
  const [onWhite, onFill] = await resultPixels([[0.3, 0.5], [0.5, 0.5]]);
  // 白の上: 黄色(#ffe14d)を80%で掛け合わせる.
  assert.ok(onWhite[0] > 240 && onWhite[1] > 215 && onWhite[2] < 140, `白の上は黄色 (実際: ${onWhite})`);
  // 黄色の長方形(#f4c95d)の上は, より濃い色になる.
  assert.ok(onFill[1] < 0xc9 && onFill[2] < 0x5d, `掛け合わせて濃くなる (実際: ${onFill})`);
  // ペンに戻すと, ペンの色と太さに戻る.
  await page.selectOption('#penType', 'pen');
  assert.equal(await page.inputValue('#penWidth'), '4');
});

test('元画像を含めて保存した編集データは, 別の画像を開いていても, それだけで元の画像ごと開ける', async () => {
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  await page.click('#addPaper');
  const file = await saveProjectToFile('#saveProjectEmbedded');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
  assert.equal(saved.image.type, 'image/png');
  assert.ok(saved.image.data.length > 100);
  assert.deepEqual(saved.document.objects.map((obj) => obj.type), ['paper', 'pen']);

  // 別の大きさの画像に開き直してから, 編集データを読み込む.
  await page.setInputFiles('#file', { name: 'other.png', mimeType: 'image/png', buffer: await makeImage(200, 100) });
  page.once('dialog', (dialog) => dialog.accept());
  await page.waitForFunction(() => document.getElementById('original').width === 200);
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.equal(await page.$eval('#original', (el) => `${el.width}x${el.height}`), '400x300');
  assert.deepEqual(await layerNames(), ['ペン', '白地']);
  const [line] = await resultPixels([[0.5, 0.5]]);
  assert.ok(near(line, [0xd8, 0x3b, 0x3b]), `線 (実際: ${line})`);
});

test('元画像を含めずに保存した編集データは, 画像が無ければ案内を出す', async () => {
  const file = await saveProjectToFile('#saveProject');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.image, undefined);
  await page.setInputFiles('#file', { name: 'other.png', mimeType: 'image/png', buffer: await makeImage(200, 100) });
  await page.waitForFunction(() => document.getElementById('original').width === 200);
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('サイズが保存データと一致しません'));
});

// ---- v2.4.0 ----
test('起動画面で「画像を開く」と「白紙から始める」を選べる', async () => {
  await page.goto(`${ORIGIN}/index.html`);
  assert.equal(await page.isVisible('#emptyState'), true);
  assert.match(await page.textContent('#emptyState'), /画像を開く/);
  assert.equal(await page.isVisible('#startBlank'), true);
  await page.click('#startBlank');
  assert.equal(await page.isVisible('#blankDialog'), true);
  const sizes = await page.$$eval('#blankForm input[name=blankSize]', (els) => els.map((el) => el.value));
  assert.deepEqual(sizes, ['1920x1080', '1080x1080', '1200x675', '1080x1350', 'custom']);
  assert.equal(await page.isDisabled('#blankWidth'), true, '自分で入力を選ぶまでは入力できない');
  // やめると何も開かない.
  await page.click('#blankCancel');
  assert.equal(await page.isVisible('#blankDialog'), false);
  assert.equal(await page.isVisible('#emptyState'), true);

  await page.click('#startBlank');
  await page.check('#blankForm input[value="1080x1080"]');
  await page.click('#blankCreate');
  await page.waitForFunction(() => !document.getElementById('original').hidden);
  assert.equal(await page.$eval('#original', (el) => `${el.width}x${el.height}`), '1080x1080');
  assert.deepEqual(await layerNames(), ['白地']);
  assert.match(await status(), /白紙を作りました：1080 × 1080 px/);
  // 作った直後は, 元に戻す対象も未保存の編集も無い.
  assert.equal(await page.isDisabled('#undo'), true);
  const [px] = await resultPixels([[0.5, 0.5]]);
  assert.ok(near(px, [255, 255, 255]), `白 (実際: ${px})`);
});

test('白紙は大きさを自分で入力でき, 範囲の外は作らない. 白地を消すと透明になる', async () => {
  await page.click('#fileMenuSummary');
  await page.click('#newBlank');
  await page.check('#blankForm input[value="custom"]');
  assert.equal(await page.isDisabled('#blankWidth'), false);
  await page.fill('#blankWidth', '5');
  await page.click('#blankCreate');
  assert.equal(await page.isVisible('#blankDialog'), true, '範囲の外なら閉じない');
  assert.match(await page.textContent('#blankNote'), /16〜8000/);
  await page.fill('#blankWidth', '320');
  await page.fill('#blankHeight', '240');
  await page.click('#blankCreate');
  await page.waitForFunction(() => document.getElementById('original').width === 320);
  assert.equal(await page.$eval('#original', (el) => el.height), 240);
  // 白地を消すと, 仕上がりは透明.
  await page.locator('#layerList [data-act=delete]').nth(0).click();
  await makeResult();
  const alpha = await page.evaluate(() => document.getElementById('result').getContext('2d').getImageData(160, 120, 1, 1).data[3]);
  assert.equal(alpha, 0);
});

test('フォントは Google Fonts だけから読み込み, ほかのサイトへは取りに行かない', async () => {
  await placeText([0.5, 0.5], '123');
  await page.waitForTimeout(200);
  assert.ok(fontRequests.length > 0);
  assert.deepEqual(fontRequests.filter((url) => !url.startsWith('https://fonts.googleapis.com/') && !url.startsWith('https://fonts.gstatic.com/')), []);
});

// ---- v2.5.0 ----
const RED = [0xd8, 0x3b, 0x3b];

test('「＋ ペイント」でペイントレイヤーを足すと, ペンの線はそのレイヤーにまとまる', async () => {
  await page.click('#addPaint');
  assert.deepEqual(await layerNames(), ['ペイント（0 本）']);
  assert.equal(await page.getAttribute('#toolPen', 'aria-pressed'), 'true', 'ペンの道具に持ち替える');
  assert.match(await page.textContent('#penTarget'), /描き先: ペイント/);
  await drawPen([[0.2, 0.3], [0.8, 0.3]]);
  await drawPen([[0.2, 0.6], [0.8, 0.6]]);
  assert.deepEqual(await layerNames(), ['ペイント（2 本）'], '1本ずつのレイヤーにはならない');
  const [a, b, off] = await resultPixels([[0.5, 0.3], [0.5, 0.6], [0.5, 0.45]]);
  assert.ok(near(a, RED) && near(b, RED), `線 (実際: ${a}, ${b})`);
  assert.ok(near(off, BLACK), `線の外 (実際: ${off})`);
});

test('ペイントレイヤーの中の線は, 1本ずつ元に戻せ, やり直せる', async () => {
  await page.click('#addPaint');
  await drawPen([[0.2, 0.3], [0.8, 0.3]]);
  await drawPen([[0.2, 0.6], [0.8, 0.6]]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await layerNames(), ['ペイント（1 本）']);
  let [a, b] = await resultPixels([[0.5, 0.3], [0.5, 0.6]]);
  assert.ok(near(a, RED) && near(b, BLACK), `2本目だけが消える (実際: ${a}, ${b})`);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await layerNames(), ['ペイント（2 本）']);
  [a, b] = await resultPixels([[0.5, 0.3], [0.5, 0.6]]);
  assert.ok(near(b, RED), `やり直すと戻る (実際: ${b})`);
});

test('消しゴムはペイントレイヤーの中だけを消し, 下の画像や白地は消さない', async () => {
  await page.click('#addPaper');
  await page.click('#addPaint');
  await page.$eval('#penWidth', (el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await drawPen([[0.1, 0.5], [0.9, 0.5]]);
  await page.selectOption('#penType', 'eraser');
  assert.equal(await page.isDisabled('#penColor'), true, '消しゴムに色は無い');
  await drawPen([[0.5, 0.2], [0.5, 0.8]]);
  assert.deepEqual(await layerNames(), ['ペイント（2 本）', '白地']);
  const [erased, kept] = await resultPixels([[0.5, 0.5], [0.3, 0.5]]);
  assert.ok(near(erased, [255, 255, 255]), `消した所は, 下の白地が見える (実際: ${erased})`);
  assert.ok(near(kept, RED), `消していない所は残る (実際: ${kept})`);
});

test('消しゴムは, ペイントレイヤーを選んでいないときは選べない. 1本ずつの線はこれまでどおり', async () => {
  await page.keyboard.press('p');
  assert.equal(await page.$eval('#penType option[value="eraser"]', (el) => el.disabled), true);
  assert.equal(await page.textContent('#penTarget'), '描き先: 1本ずつの線');
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  assert.deepEqual(await layerNames(), ['ペン']);
});

test('ペイントレイヤーを隠すと中の線がすべて消え, ロック中は描けない', async () => {
  await page.click('#addPaint');
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  await page.locator('#layerList [data-act=visible]').nth(0).click();
  assert.ok(near((await resultPixels([[0.5, 0.5]]))[0], BLACK));
  await page.locator('#layerList [data-act=visible]').nth(0).click();
  await page.locator('#layerList [data-act=lock]').nth(0).click();
  await drawPen([[0.2, 0.7], [0.8, 0.7]]);
  assert.match(await status(), /ロック中・非表示のペイントレイヤーには描けません/);
  assert.deepEqual(await layerNames(), ['ペイント（1 本）']);
});

test('ペンの道具のまま, レイヤー一覧で別のペイントレイヤーを選ぶと, 描き先が変わる', async () => {
  await page.click('#addPaint');
  await drawPen([[0.2, 0.3], [0.8, 0.3]]);
  await page.click('#addPaint');
  // 一覧の下(背面)の1つ目のレイヤーを選び直して描く.
  await page.locator('#layerList .layer-main').nth(1).click();
  assert.equal(await page.getAttribute('#toolPen', 'aria-pressed'), 'true', 'ペンのまま');
  await drawPen([[0.2, 0.6], [0.8, 0.6]]);
  assert.deepEqual(await layerNames(), ['ペイント（0 本）', 'ペイント（2 本）']);
});

test('ペイントレイヤーの蛍光ペンは, 下の色と掛け合わせて描く', async () => {
  await page.click('#addPaper');
  await page.keyboard.press('Escape');
  await drawShapeOf('rect', [0.45, 0.1], [0.55, 0.9]);
  await page.click('#addPaint');
  await page.selectOption('#penType', 'marker');
  await drawPen([[0.2, 0.5], [0.8, 0.5]]);
  const [onWhite, onFill] = await resultPixels([[0.3, 0.5], [0.5, 0.5]]);
  assert.ok(onWhite[0] > 240 && onWhite[1] > 215 && onWhite[2] < 140, `白の上は黄色 (実際: ${onWhite})`);
  assert.ok(onFill[1] < 0xc9 && onFill[2] < 0x5d, `掛け合わせて濃くなる (実際: ${onFill})`);
});

test('ペイントレイヤーは, 編集データに保存され, 画像と一緒に回る', async () => {
  await page.click('#addPaint');
  await drawPen([[0.1, 0.1], [0.3, 0.1]]);
  await page.selectOption('#penType', 'eraser');
  await drawPen([[0.2, 0.05], [0.2, 0.15]]);
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
  assert.deepEqual(saved.document.objects[0].strokes.map((s) => s.tool), ['pen', 'eraser']);
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.deepEqual(await layerNames(), ['ペイント（2 本）']);
  // 右へ90°回すと, 左上(0.15, 0.1)にあった線は, 回した後の画像の右上(0.9, 0.15)へ移る.
  await page.keyboard.press('c');
  await page.click('#rotateRight');
  assert.equal(await page.$eval('#original', (el) => `${el.width}x${el.height}`), '300x400');
  const [moved] = await resultPixels([[0.9, 0.15]]);
  assert.ok(near(moved, RED), `回した後の線 (実際: ${moved})`);
});

// ---- v2.6.0 ----
// 図形の道具で, 「すぐ下をくり抜く」を付けて置く.
async function drawCutout(type, from, to) {
  await page.keyboard.press('r');
  await page.selectOption('#shapeType', type);
  await page.check('#shapeCutout');
  await drawShapeOf(type, from, to);
  await page.keyboard.press('r');
  await page.uncheck('#shapeCutout');
  await page.keyboard.press('Escape');
}

test('くり抜きの図形は, すぐ下の白地に穴を開け, 下の画像を見せる', async () => {
  await page.click('#addPaper');
  await page.keyboard.press('Escape');
  await drawCutout('rect', [0.3, 0.3], [0.7, 0.7]);
  assert.deepEqual(await layerNames(), ['長方形・くり抜き', '白地']);
  const [hole, paper] = await resultPixels([[0.5, 0.5], [0.1, 0.9]]);
  assert.ok(near(hole, BLACK), `穴から下の画像が見える (実際: ${hole})`);
  assert.ok(near(paper, [255, 255, 255]), `穴の外は白地 (実際: ${paper})`);
});

test('くり抜きはすぐ下の1つだけを抜く. 続けて重ねたくり抜きは, 同じ相手を抜く', async () => {
  await page.click('#addPaper');
  await page.keyboard.press('Escape');
  await drawShapeOf('rect', [0.1, 0.1], [0.9, 0.9]);
  await page.keyboard.press('Escape');
  await drawCutout('ellipse', [0.2, 0.2], [0.4, 0.5]);
  await drawCutout('rect', [0.6, 0.2], [0.8, 0.5]);
  assert.deepEqual(await layerNames(), ['長方形・くり抜き', '楕円・くり抜き', '長方形・塗り', '白地']);
  const [hole1, hole2, fill] = await resultPixels([[0.3, 0.35], [0.7, 0.35], [0.5, 0.7]]);
  // 黄色の長方形だけが抜け, その下の白地が見える(白地までは抜けない).
  assert.ok(near(hole1, [255, 255, 255]), `楕円の穴 (実際: ${hole1})`);
  assert.ok(near(hole2, [255, 255, 255]), `長方形の穴 (実際: ${hole2})`);
  assert.ok(near(fill, DEFAULT_FILL), `穴の外 (実際: ${fill})`);
});

test('いちばん下のくり抜きは, 抜く相手が無いので何も描かない. 編集パネルで付け外しできる', async () => {
  await drawShapeOf('rect', [0.3, 0.3], [0.7, 0.7]);
  assert.equal(await page.isVisible('#cutoutField'), true);
  await page.check('#editCutout');
  assert.equal(await page.isVisible('#cutoutNote'), true);
  assert.deepEqual(await layerNames(), ['長方形・くり抜き']);
  assert.ok(near((await resultPixels([[0.5, 0.5]]))[0], BLACK), '相手が無ければ, 何も変わらない');
  await page.uncheck('#editCutout');
  assert.deepEqual(await layerNames(), ['長方形・塗り']);
  assert.ok(near((await resultPixels([[0.5, 0.5]]))[0], DEFAULT_FILL));
});

test('テキストのくり抜き(文字の形の穴)と, 窓のくり抜き(形の外側を消す)', async () => {
  await page.click('#addPaper');
  await page.keyboard.press('Escape');
  await placeText([0.5, 0.5], 'MMMM');
  await setRange('editTextSize', 80);
  await page.check('#editTextTransparent');
  await page.check('#editCutout');
  assert.deepEqual((await layerNames())[0], 'MMMM・くり抜き');
  await makeResult();
  const dark = await page.evaluate(() => {
    const d = document.getElementById('result').getContext('2d').getImageData(0, 0, 400, 300).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30) n += 1;
    return n;
  });
  assert.ok(dark > 500, `文字の形に, 下の黒い画像が見える (${dark} px)`);

  // 窓のくり抜きは, 形の内側だけを残す.
  await page.keyboard.press('Escape');
  await page.locator('#layerList [data-act=delete]').nth(0).click();
  await page.keyboard.press('r');
  await page.selectOption('#shapeStyle', 'window');
  await drawCutout('rect', [0.3, 0.3], [0.7, 0.7]);
  const [inside, outside] = await resultPixels([[0.5, 0.5], [0.1, 0.9]]);
  assert.ok(near(inside, [255, 255, 255]), `内側は白地が残る (実際: ${inside})`);
  assert.ok(near(outside, BLACK), `外側は抜ける (実際: ${outside})`);
});

test('モザイクをくり抜くと, 穴の部分は加工前の画像が見える', async () => {
  // 左上の赤い四角(0〜50px)にかかるモザイク(1マス40px). 40〜80px のマスは暗い赤になる.
  await drawShapeOf('mosaic', [0, 0], [0.25, 1 / 3]);
  await setRange('editStrength', 40);
  await page.keyboard.press('Escape');
  await drawCutout('rect', [41 / 400, 5 / 300], [70 / 400, 35 / 300]);
  const [red, black, mosaic] = await resultPixels([[45.5 / 400, 20.5 / 300], [60.5 / 400, 20.5 / 300], [75.5 / 400, 20.5 / 300]]);
  assert.ok(near(red, [255, 0, 0]), `穴の中の赤は, 加工前のまま (実際: ${red})`);
  assert.ok(near(black, BLACK), `穴の中の黒も, 加工前のまま (実際: ${black})`);
  assert.ok(mosaic[0] > 20 && mosaic[0] < 120, `穴の外はモザイク (実際: ${mosaic})`);
});

test('ペイントレイヤーもくり抜け, くり抜きは編集データ(形式 v9)に保存される', async () => {
  await page.click('#addPaint');
  await page.$eval('#penWidth', (el) => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await drawPen([[0.1, 0.5], [0.9, 0.5]]);
  await page.keyboard.press('Escape');
  await drawCutout('ellipse', [0.4, 0.3], [0.6, 0.7]);
  const [hole, line] = await resultPixels([[0.5, 0.5], [0.2, 0.5]]);
  assert.ok(near(hole, BLACK), `線に穴 (実際: ${hole})`);
  assert.ok(near(line, RED), `穴の外の線 (実際: ${line})`);
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
  assert.equal(saved.document.objects[1].cutout, true);
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.deepEqual(await layerNames(), ['楕円・くり抜き', 'ペイント（1 本）']);
  assert.ok(near((await resultPixels([[0.5, 0.5]]))[0], BLACK));
});

// ---- v2.8.0 ----
// 1色で塗った画像(PNG). 重ねる画像に使う.
async function makeSolid(w, h, color) {
  const base64 = await page.evaluate(([width, height, fill]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [w, h, color]);
  return Buffer.from(base64, 'base64');
}

const GREEN = [0, 200, 0];

async function addImageLayer(w, h, name = 'green.png', color = '#00c800') {
  await page.setInputFiles('#addImageFile', { name, mimeType: 'image/png', buffer: await makeSolid(w, h, color) });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('重ねました'));
}

test('「＋ 画像」で選んだ画像は, そのままの大きさで中央に重なり, 画像の欄だけが出る', async () => {
  await addImageLayer(100, 50);
  assert.deepEqual(await layerNames(), ['画像（green.png）']);
  assert.match(await selectedName(), /画像/);
  assert.deepEqual(await lastFramePx(), [150, 125, 250, 175]);
  assert.equal(await page.isVisible('#imageFields'), true);
  assert.equal(await page.isVisible('#shapeFields'), false);
  const [inside, outside] = await resultPixels([[0.5, 0.5], [0.5, 0.3]]);
  assert.ok(near(inside, GREEN), `画像の中 (実際: ${inside})`);
  assert.ok(near(outside, BLACK), `画像の外 (実際: ${outside})`);
  // 選択の道具で, 画像の上を押すと選べる.
  await page.keyboard.press('Escape');
  const p = await at(0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  assert.match(await selectedName(), /画像/);
});

test('元画像より大きい画像は, 縦横の比率を保って元画像の80%に収める. 元に戻すで消える', async () => {
  await addImageLayer(800, 300);
  // 幅 320px(400 × 80%)に合わせて 0.4 倍 → 320 × 120px.
  assert.deepEqual(await lastFramePx(), [40, 90, 360, 210]);
  await page.click('#undo');
  assert.equal(await objectCount(), 0);
  await page.click('#redo');
  assert.deepEqual(await layerNames(), ['画像（green.png）']);
  assert.ok(near((await resultPixels([[0.5, 0.5]]))[0], GREEN));
});

test('画像の四隅のハンドルは縦横の比率を保ち, Shift で比率を外せる. 「元の縦横比に戻す」で戻る', async () => {
  await addImageLayer(100, 50);
  const drag = async (from, to, shift = false) => {
    const a = await at(...from);
    const b = await at(...to);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  // 右下の隅を右へ大きく動かす → 左上を固定し, 幅に合わせて高さも 1.5 倍.
  await drag([250 / 400, 175 / 300], [300 / 400, 180 / 300]);
  assert.deepEqual(await lastFramePx(), [150, 125, 300, 200]);
  // Shift を押しながらなら, 指の位置どおり.
  await drag([300 / 400, 200 / 300], [320 / 400, 160 / 300], true);
  assert.deepEqual(await lastFramePx(), [150, 125, 320, 160]);
  await page.click('#imageAspect');
  // 幅 170px のまま, 高さを 85px にする(中心は保つ).
  const [x1, y1, x2, y2] = await lastFramePx();
  assert.deepEqual([x1, x2], [150, 320]);
  assert.ok(Math.abs(y2 - y1 - 85) <= 1, `高さ (実際: ${y2 - y1})`);
});

test('重ねた画像は, 元画像を含めない編集データにも入り(形式 v10), 読み込むと戻る', async () => {
  await addImageLayer(100, 50, 'green.png');
  await addImageLayer(40, 40, 'blue.png', '#0000ff');
  const file = await saveProjectToFile();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 10);
  assert.equal(saved.image, undefined, '元画像は含めない');
  assert.equal(saved.images.length, 2);
  assert.deepEqual(saved.document.objects.map((obj) => obj.type), ['image', 'image']);
  await page.keyboard.press('Escape');
  await page.click('#clearObjects');
  assert.equal(await objectCount(), 0);
  await page.setInputFiles('#loadProject', file);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('編集データを読み込みました'));
  assert.deepEqual(await layerNames(), ['画像（blue.png）', '画像（green.png）']);
  const [blue, green] = await resultPixels([[0.5, 0.5], [0.4, 0.5]]);
  assert.ok(near(blue, [0, 0, 255]), `上の画像 (実際: ${blue})`);
  assert.ok(near(green, GREEN), `下の画像 (実際: ${green})`);
});

test('Shift を押しながらのドロップと Ctrl+Shift+V では, 開き直さずに画像を重ねる', async () => {
  await drawRect([0.05, 0.05], [0.15, 0.15]);
  const buffer = await makeSolid(60, 30, '#00c800');
  // 確認の画面は出ない(出たら失敗にする).
  page.on('dialog', (dialog) => { errors.push(`確認の画面: ${dialog.message()}`); dialog.dismiss(); });
  await page.evaluate(async (bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, shiftKey: true }));
  }, [...buffer]);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('重ねました'));
  assert.deepEqual(await layerNames(), ['画像（drop.png）', '長方形・塗り']);
  assert.match(await status(), /1 枚/);

  await page.keyboard.press('Escape');
  // クリップボードに画像を入れてから, Ctrl+Shift+V を押す.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 30;
    canvas.getContext('2d').fillRect(0, 0, 60, 30);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.keyboard.press('Control+Shift+V');
  await page.waitForFunction(() => document.querySelectorAll('#layerList .layer-row').length === 3);
  assert.match(await status(), /画像を 1 枚重ねました/);
  // 元画像はそのまま(400 × 300 px).
  assert.equal(await page.evaluate(() => document.getElementById('original').width), 400);
});

test('画像を開き直すと, 重ねていた画像は消える. 画像レイヤーでもくり抜ける', async () => {
  await addImageLayer(200, 100);
  await page.keyboard.press('Escape');
  await drawCutout('rect', [0.45, 0.45], [0.55, 0.55]);
  const [hole, image] = await resultPixels([[0.5, 0.5], [0.35, 0.5]]);
  assert.ok(near(hole, BLACK), `穴 (実際: ${hole})`);
  assert.ok(near(image, GREEN), `穴の外の画像 (実際: ${image})`);
  await page.keyboard.press('Escape');
  page.once('dialog', (dialog) => dialog.accept());
  await loadImage();
  assert.equal(await objectCount(), 0);
  assert.equal(await page.evaluate(async () => (await import(`${location.origin}/js/image-layer.js`)).imageAssets.size), 0);
});

// ---- v2.9.0 ----
// すべてのオブジェクトの枠を, 画像上の画素で読む(背面から順).
const framesPx = () => page.evaluate(async ([w, h]) => {
  const { objects } = await import(`${location.origin}/js/state.js`);
  return objects.map((obj) => [obj.x1 * w, obj.y1 * h, obj.x2 * w, obj.y2 * h].map((v) => Math.round(v)));
}, [IMAGE_W, IMAGE_H]);
const selectedRows = () => page.locator('#layerList .layer-row.selected').count();

async function dragOn(from, to, shift = false) {
  const a = await at(...from);
  const b = await at(...to);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

// 左上に2つ, 右下に1つの長方形を置き, 選択を外す.
async function threeRects() {
  await drawRect([0.15, 0.2], [0.25, 0.3]);
  await drawRect([0.3, 0.2], [0.4, 0.3]);
  await drawRect([0.7, 0.7], [0.8, 0.8]);
  await page.keyboard.press('Escape');
}

test('選択の道具で何も無い所からドラッグすると, 範囲に触れたものをまとめて選び, まとめて動かせる', async () => {
  await threeRects();
  await page.keyboard.press('v');
  await dragOn([0.1, 0.1], [0.32, 0.25]);
  assert.equal(await page.isVisible('#multiBody'), true);
  assert.equal(await page.textContent('#multiName'), '2 個を選択中');
  assert.equal(await page.isVisible('#propBody'), false);
  assert.equal(await selectedRows(), 2);
  // 選んだものの1つを掴んで動かすと, 2つとも同じだけ動く(40px 右, 30px 下).
  await dragOn([0.2, 0.25], [0.3, 0.35]);
  assert.deepEqual(await framesPx(), [[100, 90, 140, 120], [160, 90, 200, 120], [280, 210, 320, 240]]);
  assert.equal(await selectedRows(), 2, '動かした後も選んだまま');
  // 元に戻すと, 2つとも戻り, 選んだまま.
  await page.click('#undo');
  assert.deepEqual((await framesPx()).slice(0, 2), [[60, 60, 100, 90], [120, 60, 160, 90]]);
  assert.equal(await page.textContent('#multiName'), '2 個を選択中');
  // 何も無い所をクリックすると, 選択を外す.
  const empty = await at(0.5, 0.95);
  await page.mouse.click(empty.x, empty.y);
  assert.equal(await page.isVisible('#multiBody'), false);
  assert.equal(await selectedRows(), 0);
});

test('Shift+クリックで選択に足す・外す. Delete でまとめて消え, Ctrl+A ですべて選ぶ', async () => {
  await threeRects();
  await page.keyboard.press('v');
  const first = await at(0.2, 0.25);
  const third = await at(0.75, 0.75);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(third.x, third.y);
  await page.keyboard.up('Shift');
  assert.equal(await page.textContent('#multiName'), '2 個を選択中');
  // もう一度 Shift+クリックすると外れ, 1つだけの選択に戻る.
  await page.keyboard.down('Shift');
  await page.mouse.click(third.x, third.y);
  await page.keyboard.up('Shift');
  assert.equal(await page.isVisible('#multiBody'), false);
  assert.equal(await page.isVisible('#propBody'), true);
  // Shift を押しながらの範囲選択は, 今の選択に足す.
  await dragOn([0.65, 0.65], [0.9, 0.9], true);
  assert.equal(await page.textContent('#multiName'), '2 個を選択中');
  await page.keyboard.press('Delete');
  assert.deepEqual(await framesPx(), [[120, 60, 160, 90]]);
  await page.click('#undo');
  assert.equal(await objectCount(), 3);
  await page.keyboard.press('Control+a');
  assert.equal(await page.textContent('#multiName'), '3 個を選択中');
  await page.keyboard.press('Escape');
  assert.equal(await selectedRows(), 0);
});

test('レイヤー一覧の Ctrl+クリックで選び, まとめて複製・削除できる. ロック中のものは消さない', async () => {
  await threeRects();
  const row = (i) => page.locator('#layerList .layer-main').nth(i);
  await row(0).click();
  await row(2).click({ modifiers: ['Control'] });
  assert.equal(await page.textContent('#multiName'), '2 個を選択中');
  await page.click('#multiDuplicate');
  assert.equal(await objectCount(), 5);
  assert.equal(await page.textContent('#multiName'), '2 個を選択中', '複製したものを選ぶ');
  // 複製は, 元のすぐ上に少しずらして置く(8px 右, 6px 下).
  assert.deepEqual(await framesPx(), [
    [60, 60, 100, 90], [68, 66, 108, 96], [120, 60, 160, 90], [280, 210, 320, 240], [288, 216, 328, 246],
  ]);
  // 一覧の上から2番目(右下の長方形)をロックしてから, それを含めて消す.
  await page.locator('#layerList .layer-row').nth(1).locator('[data-act="lock"]').click();
  await row(1).click();
  await row(0).click({ modifiers: ['Shift'] });
  assert.match(await page.textContent('#multiName'), /2 個を選択中（ロック中 1 個/);
  await page.click('#multiDelete');
  assert.equal(await objectCount(), 4);
  assert.match(await status(), /1 個を削除しました（ロック中の 1 個は残しました）/);
});

// ---- v2.10.0 ----
// 自動保存を待つ(編集が止まってから保存するまでの時間を待たずに, すぐ保存させる).
const flushAutosave = () => page.evaluate(async () => {
  const { flushAutosave: flush } = await import(`${location.origin}/js/autosave.js`);
  await flush();
});

async function reloadPage() {
  await page.reload();
  await page.waitForFunction(() => document.getElementById('emptyState') && !document.getElementById('emptyState').hidden);
}

test('編集すると自動保存され, 開き直すと起動画面の「前回の続き」から戻せる', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await addImageLayer(40, 40);
  await flushAutosave();
  await reloadPage();
  await page.waitForSelector('#resumeBox:not([hidden])');
  assert.match(await page.textContent('#resumeInfo'), /black\.png・レイヤー 2/);
  await page.click('#resumeAutosave');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('前回の続きを開きました'));
  assert.deepEqual(await layerNames(), ['画像（green.png）', '長方形・塗り']);
  const [rect, image, corner] = await resultPixels([[0.3, 0.3], [0.5, 0.5], [0.05, 0.05]]);
  assert.ok(near(rect, DEFAULT_FILL), `長方形 (実際: ${rect})`);
  assert.ok(near(image, GREEN), `重ねた画像 (実際: ${image})`);
  assert.ok(near(corner, [255, 0, 0]), `元画像の赤い隅 (実際: ${corner})`);
  // 戻した直後は, 元に戻すで消えない(戻した状態が最初の状態).
  assert.equal(await page.isDisabled('#undo'), true);
});

test('画像を開いただけでは前回の続きを上書きせず, 自動保存をオフにすると消える', async () => {
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await flushAutosave();
  await reloadPage();
  // 別の画像を開くだけなら, 前回の続きは残る.
  await loadImage();
  await flushAutosave();
  await reloadPage();
  await page.waitForSelector('#resumeBox:not([hidden])');
  assert.match(await page.textContent('#resumeInfo'), /レイヤー 1/);
  // 消すボタンで消せる.
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#discardAutosave');
  await page.waitForSelector('#resumeBox', { state: 'hidden' });
  await reloadPage();
  assert.equal(await page.isVisible('#resumeBox'), false);
  // オフにしている間は保存しない. 設定はページを開き直しても残る.
  await loadImage();
  await page.click('#fileMenuSummary');
  await page.uncheck('#autosaveToggle');
  await page.click('#fileMenuSummary');
  await drawRect([0.2, 0.2], [0.5, 0.5]);
  await flushAutosave();
  await reloadPage();
  assert.equal(await page.isVisible('#resumeBox'), false);
  assert.equal(await page.isChecked('#autosaveToggle'), false);
});

// ---- v2.11.0 ----
// ペイントレイヤーを足して, 横線を2本(上と下)描き, 「線を選んで動かす」に持ち替える.
async function paintTwoLines() {
  await page.click('#addPaint');
  await drawPen([[0.1, 0.2], [0.4, 0.2]]);
  await drawPen([[0.1, 0.7], [0.4, 0.7]]);
  await page.selectOption('#penType', 'move');
}

test('ペイントレイヤーの線は, 囲んで選び, ドラッグでまとめて動かせる. 元に戻すで戻る', async () => {
  await paintTwoLines();
  assert.equal(await page.isDisabled('#penWidth'), true, '線を動かすときは太さを使わない');
  // 上の線だけを囲む.
  await dragOn([0.05, 0.1], [0.5, 0.3]);
  assert.match(await status(), /線を 1 本選んでいます/);
  // 選んだ線の枠の中から, 右へ 0.4, 下へ 0.1 動かす.
  await dragOn([0.25, 0.2], [0.65, 0.3]);
  const [moved, before, other] = await resultPixels([[0.65, 0.3], [0.25, 0.2], [0.25, 0.7]]);
  assert.ok(near(moved, RED), `動かした先 (実際: ${moved})`);
  assert.ok(near(before, BLACK), `元の場所は空く (実際: ${before})`);
  assert.ok(near(other, RED), `選んでいない線はそのまま (実際: ${other})`);
  assert.deepEqual(await layerNames(), ['ペイント（2 本）']);
  await page.click('#undo');
  const [back, gone] = await resultPixels([[0.25, 0.2], [0.65, 0.3]]);
  assert.ok(near(back, RED), `元に戻る (実際: ${back})`);
  assert.ok(near(gone, BLACK), `動かした先は消える (実際: ${gone})`);
});

test('選んだ線は Delete で消え(レイヤーは残る), Ctrl+A でレイヤーの線をすべて選ぶ. 画像の外へは出さない', async () => {
  await paintTwoLines();
  await dragOn([0.05, 0.6], [0.5, 0.8]);
  await page.keyboard.press('Delete');
  assert.deepEqual(await layerNames(), ['ペイント（1 本）']);
  const [kept, removed] = await resultPixels([[0.25, 0.2], [0.25, 0.7]]);
  assert.ok(near(kept, RED), `残した線 (実際: ${kept})`);
  assert.ok(near(removed, BLACK), `消した線 (実際: ${removed})`);
  // すべて選んで, 左上の外まで動かしても, 線の端は画像の内側に止まる.
  await page.click('#undo');
  await page.keyboard.press('Control+a');
  await dragOn([0.25, 0.2], [0.0, 0.0]);
  const points = await page.evaluate(async () => {
    const { objects } = await import(`${location.origin}/js/state.js`);
    return objects[0].strokes.flatMap((s) => s.points);
  });
  assert.ok(Math.min(...points) >= 0, `点は 0 以上 (実際: ${Math.min(...points)})`);
  assert.ok(Math.abs(Math.min(...points.filter((_, i) => i % 2 === 0))) < 0.001, '左端に寄せて止まる');
  // Esc で線の選択を外しても, ペイントレイヤーは選んだまま.
  await page.keyboard.press('Escape');
  assert.match(await selectedName(), /ペイント/);
});
