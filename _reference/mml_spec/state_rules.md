# MML 状態遷移ルール

この文書は、`ctrmml` 実装における「各トラックが保持する状態」と、その状態が後続コマンドへどう影響するかを整理したものです。

主な参照元:

- `ctrmml/src/track.cpp`
- `ctrmml/src/track.h`
- `ctrmml/src/mml_input.cpp`

## トラックごとに保持される状態

各トラックは独立して次の状態を持ちます。

- オクターブ
- デフォルト長
- 全音符長 (`measure_len`)
- quantize
- early release
- shuffle
- キーシグネチャ
- ドラムモード
- echo 設定
- echo buffer
- 最後に発音したノート位置

重要なのは、トラック呼び出し `*<num>` が「文字列展開」ではなく、別トラックのイベント列を実行するサブルーチン的モデルである点です。各トラックの状態は独立なので、マクロトラック側にも固有のオクターブ・長さ・キーシグネチャが存在します。

## 初期値

`Track` の初期値は次の通りです。

- オクターブ: `DEFAULT_OCTAVE = 5`
- 全音符長: `96`
- デフォルト長: `96 / 4 = 24`
- quantize: `8/8`
- early release: `0`
- shuffle: `0`
- キーシグネチャ: C major / A minor 相当
- ドラムモード: 無効
- echo buffer: 空

MML 上の `o4` が内部で `set_octave(3)` になるため、`Track` 初期オクターブ `5` は MML 入力上の見かけと 1 ずれます。実装では `o<num>` の時だけ `-1` 補正が入ります。

## ノート長の決定順序

1 つの音符または休符の総長は次の順で決まります。

1. 後続の長さ指定があるか確認
2. `:<ticks>` なら tick 直指定
3. 数字なら `measure_len / 分母`
4. 指定がなければ `default_duration`
5. 付点 `.` を順に加算
6. shuffle を加算または減算

その後、ノートであれば `on_time` / `off_time` に分割されます。

## `on_time` と `off_time`

### quantize 使用時

`Q` が有効で `q == 0` の場合:

```text
on_time = duration * quantize / quantize_parts
off_time = duration - on_time
```

デフォルトは `Q8` なので、通常は `on_time = duration`, `off_time = 0` です。

### early release 使用時

`q` を設定すると quantize は実質無効化され、`on_time` は次のルールになります。

```text
if early_release >= duration:
    on_time = duration - 1
else:
    on_time = duration - early_release
```

つまり `q` は「休符分を後ろに確保する」設定です。

## shuffle

`s<ticks>` は以後のノート・休符・タイに対して交互に加算と減算が入ります。

処理の流れ:

1. 現在の `shuffle` 値を duration に加える
2. 直後に `shuffle = -shuffle` へ反転

このため、同長ノート列に対して swing 的な伸縮をかける用途を想定しています。

`R` や `~` による逆算時には shuffle も反転されます。

## キーシグネチャと臨時記号

通常モードでは音符解決時に次の順で音高が決まります。

1. 音名基底値を取得
2. キーシグネチャによる sharp / flat を取得
3. `+`, `-`, `=` が付いていればそれで上書き
4. オクターブ値を加算

つまり臨時記号はキーシグネチャより優先されます。

ドラムモード中はこの処理を飛ばし、`a..h` を 0..7 の線形値として扱います。

## タイ・スラー・逆算

### タイ `^`

`^` は直前の発音長に新しい duration を加算します。

- 直前イベントが末尾ならその場で `on_time/off_time` を再計算
- 途中に別イベントが挟まっていれば `TIE` か `REST` を追加

### スラー `&`

スラーは「次の音をレガートにする」ための補助イベントです。

- まず `SLUR` を追加
- 直前ノートの `off_time` を `0` にして `on_time` に足す

### リバースレスト `R`

`R` は直前イベントから duration を差し引きます。

- まず `off_time` から減算
- 足りなければ `on_time` から減算
- `SEGNO` や `LOOP_END` をまたぐ逆算はエラー

### グレースノート `~`

`~` は `R` と `NOTE` の複合です。前イベントから借りた長さだけ短い音を挿入します。

## echo buffer

echo buffer には、追加されたノートまたは休符が FIFO 的に保存されます。

- ノートはそのノート番号を push
- 休符は `0` を push

`\<duration>` 実行時は、`echo_delay` 個前の値を参照します。

- `0` なら休符として扱う
- ノート番号なら同じ高さのノートを挿入

## 条件ブロック

複数トラック選択時、`track_offset` に応じて `{.../...}` の枝が選ばれます。

例:

```text
ABC {c/e/g}
```

- A は 1 番目の枝
- B は 2 番目の枝
- C は 3 番目の枝

この選択は「行全体を各トラックに対して別々にパースする」形で実装されています。

## 継続行

トラック指定なしで始まる空白行は、前回の `last_cmd` を引き継いで処理されます。

これにより:

- 直前トラック群への MML 継続
- `@` タグ定義の複数行追記

が可能です。

## 実装時の注意点

MKVDRV-Wasm 側で再実装する際は、少なくとも次を分離して持つと安全です。

- 句読点レベルの字句解析
- トラックごとの parser state
- event builder
- reverse rest / grace / slur のような「後方修正」ロジック

特に `R`, `~`, `&`, `^`, `s` は単純な逐次 append ではなく、過去イベントの書き換えを伴うため、最初から event list を編集可能な設計にしておく必要があります。
