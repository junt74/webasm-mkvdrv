# MKVDRV-Wasm

MKVDRV-Wasm は、MKVDRV の設計思想と MDSDRV-mml 互換を継承しつつ、ブラウザ上で動作する次世代サウンドドライバを Rust + WebAssembly で構築するプロジェクトです。

現時点では Stage 1 の土台として、Rust/Wasm の `core` と Vite/TypeScript の `web` を分離したモノレポ構成に加え、ブラウザ上での単音再生、Rust 側で生成したノートイベント列による簡易シーケンス再生、そして `t l o <> cdefgab r Q q C ^ & R ~ [ ] { }` と `:ticks` 指定を扱う最小 MML パーサと MML 入力欄まで実装済みです。さらに、MML パース失敗時の byte 位置返却、`{}` の branch selection 文脈切り替え、サンプル MML 切り替え、エラー位置へのカーソル移動、周辺行表示、入力欄内の簡易ハイライトオーバーレイ、トークン種別ごとの軽い色分け、Rust 側からの複数診断返却、現在行ハイライト、トークン凡例、`_reference` 仕様書に結び付いた未対応コマンド候補、`examples.md` ベースの短い代替断片、quick fix 風の置換導線、loop/conditional 文脈ヒント、対応する開き括弧位置へのジャンプとペアハイライトも追加しています。

## ディレクトリ構成

```text
.
├── _direction/      # 企画・方針資料
├── _reference/      # AI 参照用資料（ビルド対象外）
├── assets/          # PCM / MML サンプル
├── core/            # Rust/Wasm サウンドコア
└── web/             # Vite + TypeScript フロントエンド
```

## 初期セットアップ内容

- Git リポジトリを初期化
- Cargo workspace と `core` ライブラリクレートを作成
- `wasm32-unknown-unknown` を前提にした Rust ツールチェーン設定を追加
- `web` に Vite ベースの最小フロントエンド雛形を追加
- `_reference` と `assets` の初期ディレクトリを整理

## 必要環境

- Rust stable
- `wasm32-unknown-unknown` target
- Node.js / npm

この環境では以下を確認済みです。

- `rustc 1.92.0`
- `cargo 1.92.0`
- `node v25.5.0`
- `npm 11.8.0`

## 開発の始め方

### Rust

```bash
cargo test -p mkvdrv-wasm-core
cargo build -p mkvdrv-wasm-core --target wasm32-unknown-unknown
```

### Web

```bash
cd web
npm install
npm run dev
```

初回の `npm run dev` / `npm run build` / `npm run check` では、事前に `npm` スクリプトから `../scripts/build-wasm.sh` が呼ばれ、`core` の Wasm バイナリが `web/public/wasm/mkvdrv_wasm_core.wasm` に同期されます。

### ブラウザでの確認

1. `cd web`
2. `npm run dev`
3. 表示されたページで `Start Tone` を押して単音再生を確認する
4. `Start Demo` を押して、Rust が生成したノート on/off イベント列の再生を確認する
5. MML 入力欄に短いフレーズを書いて `Play MML` を押す
6. 必要に応じて周波数とテンポのスライダーを変更する
7. `{a/b/c}` を含む MML を試す場合は `Branch Select` に 0 始まりの分岐番号を指定する
8. `MML Sample` から定番フレーズやエラー例を切り替えて挙動確認できる

パース失敗時は、Web 側ログに Rust パーサが返した error message と `offset / line / column` を表示します。加えて、MML 入力欄へフォーカスしたうえで該当位置を選択し、入力欄の直下にエラー要約と該当行のコンテキストを表示します。入力欄は簡易オーバーレイで描画しているため、音符・コマンド・数値・括弧などを軽く色分けしたうえで、エラー文字付近を背景色で強調表示できます。現在行は淡いハイライトで追従し、凡例で色の意味も確認できます。Rust 側は現時点で複数診断バッファを返せるため、構造エラーを複数同時に表示する土台があり、未対応コマンドらしい文字は `_reference/mml_spec/commands.md` と `_reference/mml_spec/examples.md` に寄せた代替書き方と短い置き換え断片付きで補足します。quick fix がある診断では、UI から複数候補のラベルを切り替えつつ、診断番号と位置付きの置換前後プレビューを確認してから適用できます。対応する開き括弧位置が取れる診断では、その開始位置へ直接ジャンプでき、opening 側も入力欄内でペアハイライトされます。現状の位置情報は UTF-8 byte offset をベースにしており、ASCII 中心の MML 記述ではそのまま文字位置として扱えます。

Chrome / Safari 系では、ユーザー操作後に `AudioContext` が有効になるため、発音開始はボタンクリック経由にしています。

## 次の実装ステップ

1. `web/src/processor.ts` のイベント実行系を、より汎用的な MML バイトコード受け取り型へ整理
2. `web` 側に簡易入力欄から一歩進めたエディタ機能を追加
3. 分岐選択文脈を単一 index から将来的な複数条件文脈へ拡張しやすい形へ整理
4. `_reference` に MML 仕様・旧実装・ハードウェア資料を段階的に蓄積

直近の作業計画は [直近改修計画.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/直近改修計画.md) に記載します。実装を行った際は、その都度この計画ファイルも更新し、完了項目・次の着手項目・優先順が現状と一致する状態を保つものとします。

## メモ

- `core/native` は将来の OSS 音源コア移植資産向けの配置先です
- `_reference` は AI に読ませる仕様資料置き場で、ビルドには含めません
- まだ `npm install` は実行していないため、`web` の依存関係取得は初回セットアップ時に行ってください
