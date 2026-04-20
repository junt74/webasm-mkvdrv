# PSG エミュレーション厳密化ロードマップ

この文書は、`SN76489` と `AY-3-8910` の再生コアを、比較用の簡易モデルから段階的に厳密化していくための実装順メモです。目的は「見た目だけチップ名が選べる状態」から、「各チップの内部状態や更新規則の違いがコード上でも明確な状態」へ進めることです。

## 基本方針

- まず `SN76489` を先に厳密化する
- `SN76489` で作った register 指向の更新構造を、`AY-3-8910` 側の基礎にも使う
- MML や `mkvdrv-song` は、当面は人が扱いやすい表現のままに保つ
- 厳密化で露出する差分は、runtime 側で register / counter / LFSR として吸収する
- HTML5 ゲーム向けライブラリとしての使いやすさは残すが、どこが「実機寄り」、どこが「実用寄り補正」かを明記する

## 目標状態

### `SN76489`

- tone 3ch の 10bit period register を持つ
- noise control を離散 source として扱う
- latch/data write 相当の更新順を持つ
- volume attenuation を table ベースで扱う
- noise LFSR の更新と reset タイミングを明示できる

### `AY-3-8910`

- 16 register 配列を持つ
- tone period / noise period / mixer / volume を register から解決する
- tone/noise mixer をチャンネルごとに制御できる
- hardware envelope period / shape を持つ
- volume register の fixed level と envelope 共有を切り替えられる

## 実装順

### Step 1. `SN76489` register モデル化

対象:

- `web/src/chips/sn76489-core.ts`
- 必要に応じて `web/src/song-runtime.ts`

内容:

- `frequency` 直指定ではなく、tone 3ch の period register を中心に状態を持つ
- MML 由来の note は、まず register 値へ変換して保存する
- noise は fixed rate 3種 + tone 2 追従 source を独立 state として持つ
- volume も register 値として保持し、出力時に attenuation table から引く

完了条件:

- 各 tone channel の内部状態を `period / volume / phase` として説明できる
- noise channel の source が `continuous` ではなく `discrete source` として表現される

現状:

- `period register` と `volume register` の shadow state を持つ段階まで実装済み
- `tone period / volume / noise control` を chip core 側 helper で書き込む段階まで実装済み
- 次は counter/LFSR の厳密化と、update 順のより明示的な分離に進む

### Step 2. `SN76489` 更新順と LFSR の厳密化

内容:

- latch/data write 相当のレジスタ更新順を表現する
- noise LFSR の reset 条件と shift 規則を明示する
- tone/noise の clock 分周と output 切り替えタイミングを整理する
- 実機寄りテーブル値とするか、近似テーブルのままにするかを文書化する

完了条件:

- `SN76489` の出音差を register state から説明できる
- 低域や noise 切り替え時の挙動が、今よりチップ由来の言葉で説明できる

### Step 3. `SN76489` 検証サンプルと回帰テスト追加

内容:

- tone 低域、中域、高域の比較サンプルを追加する
- periodic / white noise の差が分かる比較サンプルを追加する
- `tone C` 追従 noise のサンプルを追加する
- 可能なら register state をスナップショット比較する最小テストを追加する

完了条件:

- ブラウザ確認だけでなく、少なくとも一部の厳密化をテストで縛れる

### Step 4. `AY-3-8910` register array 導入

対象:

- `web/src/chips/ay38910-core.ts`
- 必要に応じて `web/src/song-runtime.ts`

内容:

- AY register array を持たせる
- tone period / noise period / mixer / volume を register から解決する
- 現在の「簡易差分」は register 解決結果として再表現する

完了条件:

- AY の内部状態を `register[0..15]` ベースで説明できる
- tone/noise mixer が pan とは別責務として分離される

### Step 5. `AY-3-8910` mixer / noise / hardware envelope 導入

内容:

- mixer register による tone/noise 有効化
- noise LFSR の AY 方式整理
- envelope period / shape の導入
- volume register の envelope enable を扱う

完了条件:

- AY 固有の「tone は鳴るが noise は切る」「noise だけ通す」が再現できる
- hardware envelope による AY らしい変化を確認できる

### Step 6. MML / export への反映

内容:

- `SN76489` と `AY-3-8910` の厳密化で必要な制御項目を整理する
- `mkvdrv-song` へ export する値を、抽象イベントのまま保つか register 寄りへ増やすか判断する
- MML 上の `@E` と AY hardware envelope の責務分離を整理する

完了条件:

- 「簡易エンベロープ」と「チップ固有エンベロープ」の境界が明確になる

## 直近で先にやること

1. `SN76489` の tone / noise / volume を register state として保持する土台を作る
2. `SN76489` の noise source と LFSR 更新規則を chip core 側へ寄せる
3. `AY-3-8910` は、その後に register array と mixer から着手する

## 今は保留にすること

- `YM2612` の本格着手
- anti-aliasing / band-limit のような高級な波形補正
- 派生チップ差の完全吸収
- 実クロック差の完全再現

まずは「構造としてチップらしい」状態を作ってから、音の細部を詰める方が安全です。
