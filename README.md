# MKVDRV-Wasm

MKVDRV-Wasm は、MKVDRV の設計思想と MDSDRV-mml 互換を継承しつつ、ブラウザ上で動作する次世代サウンドドライバを Rust + WebAssembly で構築するプロジェクトです。

現時点では Stage 1 の土台として、Rust/Wasm の `core` と Vite/TypeScript の `web` を分離したモノレポ構成に加え、ブラウザ上での単音再生と、Rust 側で生成したノートイベント列による簡易シーケンス再生まで確認できるようになっています。

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
5. 必要に応じて周波数とテンポのスライダーを変更する

Chrome / Safari 系では、ユーザー操作後に `AudioContext` が有効になるため、発音開始はボタンクリック経由にしています。

## 次の実装ステップ

1. `core` に複数波形・音量エンベロープ・音源状態管理を追加
2. `web/src/processor.ts` のイベント実行系を、MML バイトコード受け取り型へ発展
3. Rust 側でイベント列を生成し、AudioWorklet へ低コスト転送する基盤を拡張
4. `_reference` に MML 仕様・旧実装・ハードウェア資料を段階的に蓄積

## メモ

- `core/native` は将来の OSS 音源コア移植資産向けの配置先です
- `_reference` は AI に読ませる仕様資料置き場で、ビルドには含めません
- まだ `npm install` は実行していないため、`web` の依存関係取得は初回セットアップ時に行ってください
