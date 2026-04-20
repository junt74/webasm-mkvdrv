# SN76489 と AY-3-8910 の比較表

現段階では、厳密エミュレーション前の比較観点を整理することを目的にしています。

| 項目 | SN76489 | AY-3-8910 |
| --- | --- | --- |
| 基本構成 | tone 3ch + noise 1ch | tone 3ch + noise 1ch |
| 音量制御 | 4bit attenuation | 4bit amplitude |
| 代表的な印象 | 角が立ちやすく硬め | やや丸く太め |
| tone | 方形波ベース | 方形波ベース |
| noise | 専用 noise channel | mixer と組み合わせる noise |
| mixer | 左右パンは外部系に依存 | tone/noise 個別 mixer を持つ |
| hardware envelope | なし | あり |
| 実装優先度 | 最優先 | SN の土台後に拡張 |

## 段階導入の方針

### Step 1

- 共通 PSG イベント列を維持したまま、`SN76489` の period / volume / noise を整理する

### Step 2

- `AY-3-8910` の振幅カーブと noise 差分を別コアへ分離する

### Step 3

- `AY-3-8910` の mixer register 相当と tone/noise 合成制御を導入する

### Step 4

- `AY-3-8910` hardware envelope を MML / export / runtime に通す
