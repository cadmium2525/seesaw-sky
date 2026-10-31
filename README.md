# SEESAW — 空まで、もう一回。

大きな一つ目とカニの脚を持つシーソーを動かして、二人を交互に空へ打ち上げる、Three.js のブラウザゲームです。

右の木から飛び降りる人を受け止めると、反動で左の人が飛び上がります。人は左右に流れるので、シーソーを動かして次の着地に備えましょう。板の端に近いほど次のジャンプが高くなり、地面に落ちるとゲームオーバーです。

カメラは空中の人を追います。画面下の位置アシストでシーソーの位置を確かめられますが、**着地の5秒前からアシストは消えます**。最後は空中の動きと移動した感覚でキャッチしてください。最初の落下のように残り時間が5秒以下の場合、アシストは表示されません。

## 起動

Node.js 24 と npm を使用します。

```sh
npm install
npm run dev
```

ターミナルに表示されるローカル URL をブラウザで開きます。WebGL 2 に対応したブラウザが必要です。

| 操作 | キー / タッチ |
| --- | --- |
| 左右に移動 | `←` `→` または `A` `D` / 画面の左右ボタンを長押し |
| ゆっくり移動 | 移動中に `Shift` を押す |
| 開始・もう一度 | `Space` / 画面のボタン |
| 一時停止・再開 | `P` または `Esc` / 一時停止ボタン |
| リトライ | `R` |
| 音の切り替え | `M` / 音ボタン |

自己ベストは利用中のブラウザに保存されます。共有ランキングやアカウント登録はありません。

## 確認とビルド

```sh
npm test
npm run build
npm run preview
```

`dist/` が公開用ファイルです。Three.js もビルドに含むので、ゲーム実行時に外部 CDN へアクセスしません。依存パッケージをインストールしたあとは、インターネット接続なしでもローカルでビルド・実行できます。`dist/index.html` の直接ダブルクリックではなく、`npm run preview` で開いてください。

## GitHub Pages で無料公開

GitHub Free の**公開リポジトリ**を使います。GitHub Pages の標準 URL を利用すれば、独自ドメインの購入は不要です。[GitHub の公開条件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)も確認できます。

1. GitHub に公開リポジトリを作成します。
2. このフォルダのソースと `package-lock.json` をコミットして、`main` または `master` にプッシュします。`node_modules/` と `dist/` は不要です。
3. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします。
4. **Actions → Deploy to GitHub Pages → Run workflow** で初回公開します。以後は `main` / `master` にプッシュするたびに、テスト・ビルド・公開を自動実行します。
5. 成功すると **Settings → Pages** またはワークフローの deployment に公開 URL が表示されます。

公開 URL は通常 `https://<ユーザー名>.github.io/<リポジトリ名>/` です。Vite の `base: './'` により、リポジトリ名に合わせたソース修正は不要です。Pages の設定後に初回プッシュした場合は、手動実行せず自動公開されます。

GitHub Actions の公開設定は [公式のカスタムワークフロー手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に沿っています。

## コストと構成

- Three.js、TypeScript、Vite と GitHub Pages を使用する静的ゲームです。
- キャラクター・景色はコードで作成し、効果音は Web Audio で合成します。購入素材・有料 API・バックエンド・広告・アクセス解析は使いません。
- 描画とゲームの計算を分離し、物理計算は一定の時間刻みで行います。
- 本プロジェクトのコードとオリジナル素材は [MIT License](LICENSE) です。依存ライブラリのライセンスはそれぞれのパッケージに従います。

このフォルダを作成しただけではインターネット上へ公開されません。公開には上記の GitHub リポジトリと Pages 設定が必要です。
