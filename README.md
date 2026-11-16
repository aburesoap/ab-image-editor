# iMage Editor（Web 版） v2.0.0

パソコン中心の画像編集・注釈ツールです. スクリーンショットや写真に, 図形・矢印・テキストで説明を書き込んだり, 切り抜き・回転したりできます. 減色・ディザリングは「書き出し」の詳細設定にある一機能です（既定でOFF）.

**サイト: https://aburesoap.github.io/ab-image-editor/**

インストールは不要です. Chromium系ブラウザ（Chrome, Edge など）のパソコン版で開いてください. スマホでも使えますが, パソコンでの操作を優先して作っています.

## 拡張機能版との違い

Chromium の拡張機能として動く [iMage Editor（拡張機能版）](https://github.com/aburesoap/iMage-Editor-Extension) の v1.5.1 をもとにしています.

| | 拡張機能版（v1.x） | Web 版（v2.x, このリポジトリ） |
|---|---|---|
| 位置づけ | プライバシー・機密性・安定性を重視する安定版 | 日々改善するフリーツール |
| 使い方 | 拡張機能として読み込む | サイトを開く |
| 外部からの読み込み | すべて禁止（フォントも同梱） | 外部サイトのフォント・画像・スタイルを許可（https のみ） |
| 通信 | 一切なし | サイトのファイルの取得（公開先にアクセスの記録が残る）, 外部サイトからの読み込み |

画像の処理は, どちらもブラウザの中だけで行います. 開いた画像や編集内容をサーバーへ送ることはありません. 詳しくは [PRIVACY.md](PRIVACY.md) を参照してください.

編集データ（.json）の形式は, v2.0.0 の時点では拡張機能版 v1.5.1 と同じ（形式 v4）です. どちらで保存したものも, もう一方で読み込めます.

## 公開手順（GitHub Pages）

ビルドは不要で, リポジトリのファイルをそのまま公開します.

1. 作業用ブランチで変更し, `npm test` が通ることを確かめてから `main` へ取り込みます.
2. 初回だけ, GitHub のリポジトリの **Settings → Pages** で, **Source** を「Deploy from a branch」, **Branch** を `main` の `/ (root)` にして保存します.
3. `main` へプッシュすると, 数分でサイトに反映されます. 進み具合はリポジトリの **Actions** タブ（pages build and deployment）で確認できます.
4. 版を出すときは, `index.html` の画面の版の表示, `package.json` の `version`, `CHANGELOG.md` を更新し, 手元で `v2.0.0` の形のタグを付けます.

`.nojekyll` は, GitHub Pages の Jekyll による変換を止めるための空のファイルです. 削除しないでください.
ブラウザが古いファイルを使い続けているときは, Shift を押しながら再読み込みしてください.

### CSP（Content Security Policy）

`index.html` の `<meta http-equiv="Content-Security-Policy">` で設定しています. GitHub Pages では応答のヘッダーを設定できないため, meta タグで指定しています.

* フォント, 画像, スタイル, 通信（`fetch` など）: 自分自身と, https の外部サイトを許可
* スクリプト: 自分自身のファイルだけを許可（外部のスクリプトや, HTML に直接書いたスクリプトは動かない）
* `object`, フォームの送信先: 禁止

## 含まれるファイル

* `index.html` — アプリケーション本体ページ（CSP とファビコンの指定を含む）
* `studio.css` — デザイン・フォント定義
* `js/` — 編集・書き出しロジック（ES Modulesで機能ごとに分割. 読み込みの入口は `js/main.js`）
* `image-worker.js` — 画像処理用 Web Worker
* `fonts/` — 同梱フォントと, それぞれのライセンス文書
* `icons/` — アイコン（16px / 48px / 128px）. ファビコンとして使う
* `.nojekyll` — GitHub Pages の設定用（上記）
* `LICENSE` — ライセンス（MIT）
* `CHANGELOG.md` — 変更履歴
* `PRIVACY.md` — プライバシーポリシー
* `tests/`, `package.json` — 開発用の自動テスト（サイトの動作には不要）

### モジュール構成（`js/`）

依存は一方向で, 循環はありません. 下の層のモジュールは, 上の層を読み込みません.

| 層 | モジュール | 役割 |
|---|---|---|
| 基盤 | `constants.js` | 定数, 画面要素のid一覧 |
| | `validate.js` | 値の検証（型と範囲の確認） |
| | `dom.js` | 画面要素への参照, 小さな共通処理 |
| | `state.js` | 共有の状態（`state` オブジェクト, オブジェクト配列, 履歴） |
| | `colorpicker.js` | 自作のカラーピッカー（色の欄と, 色を選ぶ窓） |
| 計算・描画 | `geometry.js` | 寸法, 座標まわりの計算 |
| | `text.js` | テキストの配置計算と描画, フォントの読み込み |
| | `shapes.js` | 図形の描画, 図形・テキストの新規作成 |
| | `handles.js` | 選択枠, 当たり判定, ハンドル（画面の更新は行わない） |
| | `render.js` | プレビューの描画 |
| 機能 | `settings.js` | 書き出しの設定（色調整, 減色）の読み書き, 表示の同期 |
| | `convert.js` | 変換結果の管理, 変換の実行 |
| | `layers.js` | レイヤー一覧の表示 |
| | `inspector.js` | 選択中のオブジェクトの編集パネル |
| | `stage.js` | 作業領域での画像の表示（拡大・縮小, 移動）, 編集と結果の表示切り替え |
| | `rotate.js` | 元画像の90°単位の回転（図形・テキスト・切り抜き範囲も一緒に回す） |
| | `history.js` | 元に戻す・やり直す, 保存状態 |
| | `actions.js` | 道具・表示・タブの切り替え, オブジェクトの操作 |
| 入出力 | `open.js` | 画像を開く（ファイルの選択, ドラッグ&ドロップ, 貼り付け） |
| | `zoom.js` | 作業領域の拡大・縮小と移動の操作 |
| | `pointer.js` | プレビュー上のポインタ操作 |
| | `layerlist.js` | レイヤー一覧の操作（選択, 表示・ロック, 重ね順のドラッグ） |
| | `keyboard.js` | ショートカット |
| | `controls.js` | ボタンや入力欄の操作 |
| | `export.js` | 画像の保存, クリップボードへのコピー |
| | `project.js` | 編集データの保存と読み込み |
| | `session.js` | 画面への復帰, 未保存の警告 |
| 起動 | `main.js` | 起動処理 |

## 同梱フォント

| フォント | 用途 | ファイル |
|---|---|---|
| IBM Plex Sans JP（Regular / SemiBold / Bold） | 画面全体, 画像に入れる文字 | `IBMPlexSansJP-*.woff` |
| IBM Plex Math（Regular） | 数値の表示 | `IBMPlexMath-Regular.woff2` |
| UDEV Gothic v2.2.0（Regular） | 状態表示, フッター | `UDEVGothic-Regular.woff` |

いずれも SIL Open Font License 1.1 で配布されています. 各ライセンス文書は `fonts/LICENSE-*.txt` を参照してください.
フォントを読み込めない場合は, 端末にインストールされているフォント（Hiragino Sans, Yu Gothic UI, Meiryo など）へ自動的に切り替わります.

## 開発

### 手元で開く

ES Modules と Web Worker を使うため, `index.html` をファイルとして直接開くと動きません. 簡単なサーバーで開いてください.

```bash
python3 -m http.server 8000
```

ブラウザで http://localhost:8000/ を開きます.

### 自動テスト

画面をブラウザ（Chromium）で実際に操作して, 主な機能を確かめるテストです. Node.js 20以降が必要です.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

テストは, ファイルを直接返す仮のサイトとして画面を開きます. 外部への通信は行いません（外部サイトからの読み込みを確かめるテストも, 仮の外部サイトを使います）.

## 変更履歴

各版の変更点は [CHANGELOG.md](CHANGELOG.md) を参照してください.
