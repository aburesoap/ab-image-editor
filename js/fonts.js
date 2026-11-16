// フォントの一覧と読み込み. フォントのファイルは同梱せず, 外部サイトから読み込む.
// 読み込めないとき(オフライン, 読み込み先の障害など)は, fallback に並べた端末内のフォントで表示する.
//
// テキストに使えるフォントを足すときは, TEXT_FONTS に1件足すだけでよい(選択肢や編集データの検証は, この一覧から作る).
//   label    … 選択肢に出す名前
//   family   … CSS の font-family 名(読み込み先が定義している名前と揃える)
//   fallback … 読み込めないときに使う端末内のフォント
//   weights  … 使える太さ(400 / 600 / 700 のうち, 読み込み先にあるもの)
//   css      … フォントを定義したスタイルシートのURL(Google Fonts など). または,
//   files    … 太さごとのフォントファイル(woff2)のURL
// どちらも https のURLに限る(index.html の CSP が https だけを許可している).
// 足したときは, PRIVACY.md の「外部サイトからの読み込み」に読み込み先を書く.

const SANS_FALLBACK = '"Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SFMono-Regular", Consolas, "Noto Sans Mono CJK JP", monospace';

export const TEXT_FONTS = {
  plex: {
    label: 'IBM Plex Sans JP',
    family: 'IBM Plex Sans JP',
    fallback: SANS_FALLBACK,
    weights: [400, 600, 700],
    css: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;600;700&display=swap',
  },
  udev: {
    label: 'UDEV Gothic（等幅）',
    family: 'UDEV Gothic',
    fallback: MONO_FALLBACK,
    weights: [400],
    files: { 400: 'https://cdn.jsdelivr.net/npm/@sarap422/font-udevgothic@1.0.0/UDEVGothic-Regular.woff2' },
  },
};

// 画面の表示にだけ使うフォント(studio.css の --font-num). テキストの選択肢には出さない.
const UI_ONLY_FONTS = {
  plexMath: {
    family: 'IBM Plex Math',
    weights: [400],
    files: { 400: 'https://cdn.jsdelivr.net/npm/@ibm/plex-math@1.1.0/fonts/complete/woff2/IBMPlexMath-Regular.woff2' },
  },
};
// 画面の表示に使うため, 起動時に読み込みを始めるフォント. studio.css の --font-sans / --font-mono / --font-num と揃える.
const STARTUP_FONTS = ['plex', 'udev', 'plexMath'];

export const DEFAULT_FONT = 'plex';
export const FONT_KEYS = Object.keys(TEXT_FONTS);
export const FONT_WEIGHTS = [400, 600, 700];
export const WEIGHT_LABELS = { 400: '標準', 600: '中太', 700: '太字' };

const fontOf = (key) => TEXT_FONTS[key] || TEXT_FONTS[DEFAULT_FONT];

// canvas や CSS に渡す font-family の並び. 読み込めないときの端末内フォントを後ろに付ける.
export const fontStack = (key) => {
  const font = fontOf(key);
  return `"${font.family}", ${font.fallback}`;
};

// そのフォントで使える太さのうち, 指定に最も近いもの.
export function nearestWeight(key, weight) {
  const { weights } = fontOf(key);
  const wanted = Number(weight) || 400;
  return weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0]);
}

export const fontWeights = (key) => fontOf(key).weights;

// 読み込みを始めたフォント(キー → 定義が使えるようになると解決する Promise).
const started = new Map();

// フォントの定義を画面へ登録する. フォントのファイルそのものは, 実際に使う文字が出てきたときにブラウザが取りに行く.
// 同じフォントは1度だけ登録する. 失敗しても止めず, 端末内のフォントで表示を続ける.
export function ensureFont(key) {
  if (started.has(key)) return started.get(key);
  const font = TEXT_FONTS[key] || UI_ONLY_FONTS[key];
  let ready = Promise.resolve();
  if (font?.css) {
    ready = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = font.css;
      link.dataset.font = key;
      link.addEventListener('load', resolve);
      link.addEventListener('error', resolve);
      document.head.append(link);
    });
  } else if (font?.files && document.fonts && typeof window.FontFace === 'function') {
    Object.entries(font.files).forEach(([weight, url]) => {
      document.fonts.add(new window.FontFace(font.family, `url("${url}") format("woff2")`, { weight, style: 'normal', display: 'swap' }));
    });
  }
  started.set(key, ready);
  return ready;
}

// 起動時に, 画面の表示に使うフォントの読み込みを始める.
export function loadStartupFonts() {
  STARTUP_FONTS.forEach(ensureFont);
}
