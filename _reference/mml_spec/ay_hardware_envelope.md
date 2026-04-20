# AY-3-8910 Hardware Envelope 暫定仕様

この文書は、MKVDRV-Wasm における AY-3-8910 向け hardware envelope 制御の暫定仕様をまとめたものです。

`@E` と `S` は従来通り software envelope 系として扱い、AY 固有の hardware envelope は 2 文字コマンドで分離します。

## コマンド一覧

- `EH<num>`
  hardware envelope の shape を設定します
- `EP<num>`
  hardware envelope の period を設定します
- `EE0`
  現在チャンネルの hardware envelope を無効化します
- `EE1`
  現在チャンネルの hardware envelope を有効化します

## 役割分担

- `@E`
  カスタム software envelope
- `S`
  共通意味の preset software envelope
- `EH`
  AY hardware envelope shape
- `EP`
  AY hardware envelope period
- `EE`
  AY hardware envelope enable

## 基本ルール

- `EH` と `EP` は AY の共通 hardware envelope generator 設定として扱います
- `EE` はチャンネルごとの enable/disable として扱います
- `EE1` のチャンネルは固定 volume の代わりに hardware envelope 出力で音量を決めます
- `@E` または `S` を選んだチャンネルは `EE0` 扱いへ戻します
- `EE1` を再指定すると、そのチャンネルは hardware envelope 利用へ戻ります
- 最後に指定した方式が有効です

## 書式例

```mml
A EP512 EH9 EE1 c2
```

```mml
A EP768 EH10 EE1 c4 EE0 r4
```

## 実装上の暫定方針

- `EH` の有効値は `0` から `15`
- `EP` は `1` 以上の整数
- `EE` は `0` または `1`
- 初期実装では AY モデル時のみ意味を持ちます
- `SN76489` モデル時はイベントとして保持されても、再生上は無視して構いません

## `EH` shape の解釈

AY-3-8910 の hardware envelope shape は 4bit 値として扱います。暫定的には次の bit 意味で整理します。

- bit3: `continue`
- bit2: `attack`
- bit1: `alternate`
- bit0: `hold`

この 4bit を元に、1 サイクル終端時の挙動を決めます。

- `attack=0`
  15 から 0 へ下がる向きで開始
- `attack=1`
  0 から 15 へ上がる向きで開始
- `continue=0`
  初回サイクル後に 0 側で停止する単発扱い
- `continue=1`
  サイクル終端後も継続
- `alternate=1`
  サイクル終端ごとに進行方向を反転
- `hold=1`
  継続時でも終端値で保持して停止

## `EH0` から `EH15` の暫定整理

| EH | C A Alt H | 開始 | 終端後の挙動 | 聴感上の目安 |
| --- | --- | --- | --- | --- |
| `EH0` | 0 0 0 0 | 下降 | 0 で停止 | 単発下降 |
| `EH1` | 0 0 0 1 | 下降 | 0 で停止 | 単発下降 |
| `EH2` | 0 0 1 0 | 下降 | 0 で停止 | 単発下降 |
| `EH3` | 0 0 1 1 | 下降 | 0 で停止 | 単発下降 |
| `EH4` | 0 1 0 0 | 上昇 | 0 で停止 | 単発上昇ののち停止 |
| `EH5` | 0 1 0 1 | 上昇 | 0 で停止 | 単発上昇ののち停止 |
| `EH6` | 0 1 1 0 | 上昇 | 0 で停止 | 単発上昇ののち停止 |
| `EH7` | 0 1 1 1 | 上昇 | 0 で停止 | 単発上昇ののち停止 |
| `EH8` | 1 0 0 0 | 下降 | 再始動を繰り返す | 反復下降 |
| `EH9` | 1 0 0 1 | 下降 | 0 で保持 | 下降して止まる |
| `EH10` | 1 0 1 0 | 下降 | 反転しながら往復 | 三角波寄り |
| `EH11` | 1 0 1 1 | 下降 | 0 で保持 | 下降して止まる |
| `EH12` | 1 1 0 0 | 上昇 | 再始動を繰り返す | 反復上昇 |
| `EH13` | 1 1 0 1 | 上昇 | 15 で保持 | 上昇して止まる |
| `EH14` | 1 1 1 0 | 上昇 | 反転しながら往復 | 三角波寄り |
| `EH15` | 1 1 1 1 | 上昇 | 15 で保持 | 上昇して止まる |

注記:

- `continue=0` の 0 から 7 は、細部のビット差があっても最終的には「単発系」として潰れる扱いになりやすいです
- `EH10` と `EH14` は確認用サンプルでも差が分かりやすく、往復系の基準 shape として使えます
- `EH9` と `EH13` は「終端保持」の代表として確認しやすい shape です

## 現行実装との差分メモ

現行 Stage 1 実装は、この shape 解釈を元にした最小実装です。ただし、まだ次の点は厳密化の余地があります。

- サイクル終端時の `continue=0` 系の細かい収束値
- `alternate` の反転タイミング
- period の減算単位と sample rate 依存の丸め方
- AY mixer / fixed volume / hardware envelope の結合順

実装上は `resolveAyHardwareEnvelopeCycleEnd()` 相当の分岐で、サイクル終端ごとの `step / direction / holding` を決める方針にしています。

今後はこの文書を基準に、shape ごとの遷移表と実装を照合しながら詰めていきます。

## 今後の拡張候補

- shape ごとの厳密な波形遷移の見直し
- AY mixer 実装との統合
- export 形式への AY register state 反映
