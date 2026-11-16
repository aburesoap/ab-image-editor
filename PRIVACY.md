# プライバシーポリシー（iMage Editor Web 版）

最終更新: 2026年11月16日（v2.1.1 時点）

iMage Editor Web 版（以下「本サイト」）は, GitHub Pages で公開している画像編集・注釈ツールです. 開いた画像や編集内容は, ブラウザの中で処理し, サーバーへ送信しません. ただし, 本サイトを開くときの通信と, 外部サイトからの読み込みがあるため, 「端末の外へ一切通信しない」ものではありません.

機密性の高い画像を扱う場合は, 外部との通信を一切行わない [拡張機能版](https://github.com/aburesoap/iMage-Editor-Extension) の利用をおすすめします.

## 送信しない情報

* 開いた画像, 書き込んだ図形やテキスト, 編集データは, ブラウザの中で処理され, 本サイトの作者や外部のサーバーへ送信されません
* アクセス解析, 広告, 利用状況の計測は行いません

## 通信が発生する場面

### 本サイトを開くとき（公開先のアクセスの記録）

本サイトのファイル（HTML, スクリプト, アイコンなど）は, GitHub Pages から配信されます. ファイルを取得する際, 一般的なウェブサイトと同様に, IPアドレス, ブラウザの種類, アクセス日時などが GitHub に送られ, 記録されることがあります. この記録は GitHub が管理しており, 本サイトの作者は参照しません. 詳しくは [GitHub のプライバシーに関する声明](https://docs.github.com/ja/site-policy/privacy-policies/github-general-privacy-statement) を参照してください.

### 外部サイトからの読み込み

本サイトの設定（Content Security Policy）は, https の外部サイトからフォント・画像・スタイルを読み込むことを許可しています. 外部サイトから読み込むと, そのサイトに IPアドレスやブラウザの種類などが伝わります.

v2.1.1 の時点で, 本サイトが外部サイトから読み込むものは, 次のフォントだけです. 本サイトを開いたとき, またはそのフォントのテキストを置いたときに読み込みます. 読み込み先には, IPアドレス, ブラウザの種類, 本サイトから読み込んだこと（参照元）などが伝わります. 開いた画像や, 入力した文字の内容は送られません（日本語のフォントは文字のまとまりごとに小分けで配られるため, どのまとまりを取得したかは読み込み先に伝わります）.

| 読み込み先 | 運営 | 読み込むもの |
|---|---|---|
| `fonts.googleapis.com`, `fonts.gstatic.com` | Google（[Google Fonts のプライバシーに関する説明](https://developers.google.com/fonts/faq/privacy?hl=ja)） | IBM Plex Sans JP |
| `cdn.jsdelivr.net` | jsDelivr（[プライバシーポリシー](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net)） | IBM Plex Math, UDEV Gothic |

読み込み先を増やした場合は, この表に記載します. フォントを読み込めない場合は, 端末内のフォントで表示します. 外部のスクリプトは, 設定で読み込みを禁止しています.

## 端末に保存する情報

* **最近使った色**: カラーピッカーで使った色（最大12色）を, ブラウザの保存領域（localStorage）に保存します. この情報は端末の外へ送信されず, ブラウザの「サイトデータの削除」で消えます
* 画像や編集内容は, 利用者が「保存」「編集データを保存」を選んだときに, 利用者が指定したファイルとしてのみ保存されます

## 利用者の操作でのみ使う機能

次の機能は, 利用者がその操作をしたときにだけ働きます.

* **ファイルの読み込み**: 利用者が選んだファイル, 画面へドロップしたファイルだけを読み込みます
* **クリップボード**: 「コピー」を押したときに仕上がりの画像を書き込み, Ctrl+V で貼り付けたとき, または「貼り付け」ボタンを押したときに画像を読み込みます. それ以外のときにクリップボードを読むことはありません
* **スポイト**: スポイトのボタンを押したときに, 利用者が画面上で選んだ1点の色だけを取得します

## 変更

このポリシーを変更する場合は, このファイルを更新し, 変更履歴（CHANGELOG.md）に記載します.

## お問い合わせ

ご質問は, GitHub のリポジトリ（[aburesoap/ab-image-editor](https://github.com/aburesoap/ab-image-editor)）の Issues でお知らせください.

---

# Privacy Policy (iMage Editor Web)

Last updated: November 16, 2026 (as of v2.1.1)

iMage Editor Web ("the site") is an image editing and annotation tool published on GitHub Pages. Images you open and your edits are processed inside your browser and are never sent to any server. However, because the site itself is downloaded over the network and may load content from other sites, it is not a "no network at all" tool.

If you work with confidential images, we recommend the [browser extension version](https://github.com/aburesoap/iMage-Editor-Extension), which makes no network requests at all.

## Information we do not send

* Images you open, shapes and text you add, and project data are processed inside the browser and are never sent to the author or to any other server
* No analytics, advertising, or usage tracking

## When network requests happen

### Opening the site (access logs on the host)

The site's files (HTML, scripts, icons, etc.) are served by GitHub Pages. As with any website, your IP address, browser type, and access time may be sent to and logged by GitHub when these files are requested. These logs are managed by GitHub and are not accessed by the author. See the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) for details.

### Loading content from other sites

The site's Content Security Policy allows fonts, images, and stylesheets to be loaded from other sites over https. When such content is loaded, that site receives your IP address, browser type, and similar information.

As of v2.1.1, the only content the site loads from other sites is the fonts below. They are loaded when you open the site, or when you place text that uses the font. The font host receives your IP address, browser type, and the fact that the request came from this site (the referrer). Your images and the text you type are not sent (Japanese fonts are served in small chunks of characters, so the host can see which chunks were requested).

| Host | Operator | What is loaded |
|---|---|---|
| `fonts.googleapis.com`, `fonts.gstatic.com` | Google ([Google Fonts privacy FAQ](https://developers.google.com/fonts/faq/privacy)) | IBM Plex Sans JP |
| `cdn.jsdelivr.net` | jsDelivr ([privacy policy](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net)) | IBM Plex Math, UDEV Gothic |

If more sources are added, they will be listed in this table. If a font cannot be loaded, fonts installed on your device are used instead. Scripts from other sites are blocked by the policy.

## Information stored on your device

* **Recent colors**: up to 12 colors used in the color picker are stored in the browser's local storage (localStorage). They never leave your device, and are removed when you clear the site's data
* Images and edits are saved only as files you choose, when you use "Save" or "Save project data"

## Features used only on your action

* **Opening files**: only files you select or drop onto the page are read
* **Clipboard**: the finished image is written when you press "Copy", and an image is read when you press Ctrl+V or the "Paste" button. The clipboard is not read at any other time
* **Eyedropper**: only the single on-screen color you pick is read, when you press the eyedropper button

## Changes

If this policy changes, this file will be updated and the change noted in CHANGELOG.md.

## Contact

Please open an issue in the GitHub repository ([aburesoap/ab-image-editor](https://github.com/aburesoap/ab-image-editor)).
