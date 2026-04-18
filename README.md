# MKVDRV-Wasm

MKVDRV-Wasm は、MKVDRV の設計思想と MDSDRV-mml 互換を継承しつつ、ブラウザ上で動作する次世代サウンドドライバを Rust + WebAssembly で構築するプロジェクトです。

現時点では Stage 1 の土台として、Rust/Wasm の `core` と Vite/TypeScript の `web` を分離したモノレポ構成に加え、ブラウザ上での単音再生、Rust 側で生成したノートイベント列による簡易シーケンス再生、そして `t l o <> cdefgab r Q q C ^ &` と `:ticks` 指定を扱う最小 MML パーサと MML 入力欄まで実装済みです。

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

Chrome / Safari 系では、ユーザー操作後に `AudioContext` が有効になるため、発音開始はボタンクリック経由にしています。

## 次の実装ステップ

1. `core` の MML パーサを `R`, `~` などの後方修正系へ段階的に拡張
2. `web/src/processor.ts` のイベント実行系を、より汎用的な MML バイトコード受け取り型へ整理
3. `web` 側に簡易入力欄から一歩進めたエディタ機能を追加
4. `_reference` に MML 仕様・旧実装・ハードウェア資料を段階的に蓄積

直近の作業計画は [直近改修計画.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/直近改修計画.md) に記載します。実装を行った際は、その都度この計画ファイルも更新し、完了項目・次の着手項目・優先順が現状と一致する状態を保つものとします。

## メモ

- `core/native` は将来の OSS 音源コア移植資産向けの配置先です
- `_reference` は AI に読ませる仕様資料置き場で、ビルドには含めません
- まだ `npm install` は実行していないため、`web` の依存関係取得は初回セットアップ時に行ってください
