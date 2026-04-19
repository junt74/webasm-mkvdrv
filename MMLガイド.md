# MKVDRV-Wasm MMLガイド

この文書は、現時点の MKVDRV-Wasm で使える MML の書き方をまとめたガイドです。

目的は 2 つです。

- ユーザー向けの簡易マニュアルとして、今すぐ使える記法を確認しやすくする
- 開発向けの実装済み一覧として、どこまで動くかを明確にする

対象は、現在の `AN74689` 互換 PSG ベース実装です。

## 1. 現在の位置づけ

MKVDRV-Wasm の MML は、MDSDRV-mml 系の書き味を参考にしつつ、Stage 1 時点で必要な範囲から段階的に実装しています。

現時点では、次の用途に使えます。

- ブラウザ確認ページでの再生
- `mkvdrv-song` JSON へのエクスポート
- HTML5 ゲーム向け単体エンジンでの再生

## 2. まず使う最小例

```mml
t124 o6 l16 ceg>c<g e c r dfa>c+<a f d r
```

この 1 行で次を使っています。

- `t124` テンポ
- `o6` オクターブ
- `l16` 既定音長
- `cdefgab` 音名
- `>` `<` オクターブ移動
- `r` 休符
- `c+` 半音上げ

## 3. 実装済みコマンド一覧

以下は「現時点で使える」ものです。

### 基本音符・休符

- `c d e f g a b`
  通常の音符です
- `r`
  休符です
- `+`
  音名直後で半音上げです
  例: `c+`, `f+`, `a+`
- `>`
  オクターブを 1 つ上げます
- `<`
  オクターブを 1 つ下げます

### 長さ・テンポ・状態

- `t<num>`
  BPM テンポです
- `L<num>`
  曲全体の巻き戻し回数です
  `L0` はループなし、`L3` は 3 回巻き戻すので合計 4 回再生、`L-1` は無限ループです
- `o<num>`
  オクターブ指定です
- `l<num>`
  既定音長です
- `l:tick`
  tick 直指定の既定音長です
- `C<num>`
  1 小節あたりの tick 数です
- `C:tick`
  tick 直指定版です
- `.`
  付点です
- `:tick`
  個別音符や休符の tick 直指定です

### 発音長・アーティキュレーション

- `Q<num>`
  量子化です
  例: `Q6`
- `q<num>`
  early release です
  例: `q3`
- `^`
  直前の音符または休符を延長します
- `&`
  直前ノートとのスラーです
- `R`
  リバースレストです
  直前イベントから長さを差し引きます
- `~`
  グレースノートです
  例: `c~d:3`, `g~c+:2`

### ループ・条件分岐

- `[ ... ]n`
  部分ループです
- `[body/break]n`
  最終回だけ break 節をスキップするループです
- `{a/b/c}`
  条件分岐です
  確認ページの `Branch Select` で 0 始まりの枝番号を選びます

### チャンネル指定

- `A`
  tone ch 1
- `B`
  tone ch 2
- `C`
  tone ch 3
- `N`
  noise ch

行頭に書くと、その行のイベントを対応チャンネルへ振り分けます。

例:

```mml
A t132 o4 l8 c>c<g e
B o3 l8 c g c g
C o2 l4 c r
N l8 c r c r
```

### 音量・ノイズ

- `v<num>`
  coarse volume です
  現状は 0 から 15 の範囲で扱います
- `w0`
  periodic noise
- `w1`
  white noise

### エンベロープ

- `@E<num>={...}`
  ユーザー定義エンベロープの定義
- `@E<num>`
  ユーザー定義エンベロープの選択
- `S<num>`
  内蔵プリセットエンベロープの選択
- `S0`
  プリセットエンベロープ解除

`@E` と `S` の違い:

- `@E` は自分で波形を定義したいとき
- `S` は手早く音の立ち上がりや減衰を試したいとき

プリセット一覧は [Sプリセットエンベロープ仕様.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/Sプリセットエンベロープ仕様.md) を参照してください。

## 4. 書き方の例

### 単音フレーズ

```mml
t124 o6 l16 ceg>c<g e c r dfa>c+<a f d r
```

### 量子化と early release

```mml
t120 o4 l8 Q6 c d e f
t120 o4 l8 q3 c d e f
```

### グレースノート

```mml
t132 o5 l8 c~d:3 e~f+:2 g
```

### ユーザー定義エンベロープ

```mml
@E1={1,0,2,4,6,8,10,12,14}
A t132 o4 l8 @E1 v14 c e g > c
```

### プリセットエンベロープ

```mml
A t132 o4 l8 S3 c e g > c
B o3 l8 S5 c c g g
N l8 S8 w1 c r c r
```

### 部分ループ

```mml
t124 o5 l8 [c e g > c]2 r
```

### 条件分岐

```mml
t128 o4 l8 c{d/e/f}g
```

## 5. 実装済み機能の補足

### 5.1 曲末の挙動

現状の `Play MML` は、`L<num>` が無い限り曲全体を自動ループしません。

- 最後まで再生すると停止します
- 末尾の `r` も終端側の休符として有効です
- 曲全体を繰り返したい場合は `L<num>` を先頭付近に書きます
- 部分的に繰り返したい場合は `[]` を使います

例:

```mml
L0 t124 o5 l8 cdefg
L3 t124 o5 l8 cdefg
L-1 t124 o5 l8 cdefg
```

### 5.2 `+` の扱い

現時点では、半音上げは音名直後の `+` に対応しています。

例:

- `c+`
- `f+`
- `a+`
- `~c+:3`

`-` によるフラットはまだ未実装です。

### 5.3 オクターブ内部表現

MML 上の `o4` は、そのままノート番号へは写していません。内部では PSG 再生向けの都合でオフセットを持っています。

通常利用では気にしなくて大丈夫ですが、テストや実装を追うときは「見た目の octave」と「内部 note number」が 1 段ずれて見えることがあります。

## 6. 確認ページでできること

`web` の確認ページでは次を使えます。

- `Start Tone`
  単音プレビュー
- `Start Demo`
  Rust 側デモイベント列の再生
- `Play MML`
  入力した MML の再生
- `Export Song JSON`
  現在の MML を JSON へ書き出し
- `Branch Select`
  `{}` の分岐番号切り替え
- `Sound Engine`
  `AN74689 PSG` と `Sine Test` の切り替え
- `MML Sample`
  サンプル MML の切り替え
- `Envelope Shortcut`
  `S1` から `S9` をカーソル位置へ挿入

## 7. エラー表示

確認ページでは、パース失敗時に次が使えます。

- エラー位置表示
- エラー箇所へのカーソル移動
- 周辺行コンテキスト表示
- 入力欄内オーバーレイでの簡易ハイライト
- 複数診断表示
- quick fix のプレビューと適用
- 対応する開き括弧位置へのジャンプ

## 8. 未実装・今後の候補

以下は reference にはあるものの、現時点では未実装または限定対応です。

- `-` によるフラット
- キーシグネチャ `_{...}`
- パン系
- detune 系
- pitch envelope 系
- drum mode 系
- 曲全体ループの明示 API
- より本格的なチップ寄り MML 拡張

未対応コマンドを入力した場合、確認ページでは `_reference/mml_spec/commands.md` や `examples.md` に寄せた候補メッセージが出ることがあります。

## 9. 関連文書

- [README.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/README.md)
- [ユーザーマニュアル.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/ユーザーマニュアル.md)
- [Sプリセットエンベロープ仕様.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/Sプリセットエンベロープ仕様.md)
- [楽曲データエクスポート仕様.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/楽曲データエクスポート仕様.md)
- [_reference/mml_spec/commands.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/_reference/mml_spec/commands.md)
- [_reference/mml_spec/examples.md](/Users/junt74/Projects/webasm/webasm-mkvdrv/_reference/mml_spec/examples.md)
