# The Hunt - システム仕様書

## 1. プロジェクト概要
FFXIVのモブハント情報をリアルタイムで管理・共有するWebアプリケーション。
ユーザーはモブの湧き時間、討伐状況、湧き位置などを確認・報告できる。

### 技術スタック
- **Frontend**: HTML5, CSS3 (Tailwind CSS + Custom CSS), Vanilla JavaScript (ES Modules)
- **Backend**: Firebase (Firestore, Authentication, Cloud Functions)
- **Hosting**: Firebase Hosting
- **Libraries**:
  - Tailwind CSS (CDN)
  - Marked.js (Markdown parsing)
  - Google Fonts (Inter)

## 2. ディレクトリ構成
```
/
├── index.html          # アプリケーションエントリーポイント
├── style.css           # グローバルスタイル・カスタムCSS変数
├── mob_data.json       # モブ基本データ（静的）
├── maintenance.json    # メンテナンススケジュール情報
├── icon/               # アセット：アイコン類
├── maps/               # アセット：マップ画像
└── src/                # ソースコード
    ├── app.js          # 初期化、イベントリスナー設定
    ├── dataManager.js  # 状態管理 (State)、データフェッチ
    ├── server.js       # Firebase連携 (Firestore, Auth)
    ├── uiRender.js     # DOM生成・更新、レンダリングロジック
    ├── filterUI.js     # フィルタリング・ソートロジック
    ├── cal.js          # 時間計算 (ET/LT)、湧き時間算出
    ├── location.js     # マップ描画、湧き位置管理
    ├── modal.js        # 報告モーダル制御
    ├── tooltip.js      # ツールチップ表示制御
    └── readme.js       # README表示制御
```

## 3. データアーキテクチャ

### 3.1 静的データ (`mob_data.json`)
モブIDをキーとしたオブジェクト。
- `rank`: S, A, F
- `name`: モブ名称
- `area`: エリア名
- `repopSeconds`: 最短湧き間隔 (秒)
- `maxRepopSeconds`: 最長湧き間隔 (秒)
- `condition`: 湧き条件テキスト
- `locations`: 湧き候補地点リスト (id, x, y, mob_ranks)

### 3.2 動的データ (Firestore)
- **`mob_status`**: 討伐情報
  - `last_kill_time`: 最終討伐時刻 (Timestamp)
  - `prev_kill_time`: 前回の討伐時刻
- **`mob_locations`**: 湧き潰し情報
  - モブIDごとのドキュメント。フィールドは `point_id: boolean` (true=culled)。
- **`shared_data/memo`**: メモ情報
  - `memo_text`: メモ内容
  - `created_at`: 作成日時

### 3.3 状態管理 (`dataManager.js`)
`state` オブジェクトで一元管理。
- `mobs`: 結合されたモブデータの配列
- `maintenance`: メンテナンス情報
- `filter`: フィルタ設定 (Rank, Area)
- `mobLocations`: 湧き潰し状態のキャッシュ

## 4. コアロジック

### 4.1 湧き時間計算 (`cal.js`)
- **通常時**: `last_kill_time` + `repopSeconds` = `minRepop`
- **メンテナンス時**:
  - メンテナンス開始〜終了(ServerUp)の間はカウント停止扱い。
  - `ServerUp` + `repopSeconds * 0.6` = メンテナンス明けの短縮湧き時間。
- **特殊条件**: 天候、ET、月齢などの条件を考慮し、`nextConditionSpawnDate` を算出。

### 4.2 ステータス判定
- **Next**: 湧き時間前
- **PopWindow**: 湧き時間内 (MinRepop <= Now < MaxRepop)
- **MaxOver**: 最長湧き時間超過 (Now >= MaxRepop)
- **ConditionActive**: 特殊条件を満たしている期間

### 4.3 ソートロジック (`uiRender.js`)
1. **MaxOver優先**: MaxOver状態のモブを最優先 (S > F > A)。
2. **進行度順**: 湧き時間の進行度 (`elapsedPercent`) が高い順。
3. **時間順**: `minRepop` が早い順。
4. **ランク順**: S > A > F。
5. **拡張パッチ順**: 黄金 > 暁月 > 漆黒 > 紅蓮 > 蒼天 > 新生。
6. **ID順**: 最終的な安定ソート用。

※メンテナンス影響下（停止中・被り）のモブは、リストの**一番下**に自動的に並び替えられる。

## 5. UIデザインシステム

### 5.1 カラーパレット (`style.css`)
- **背景**: `--bg-dark` (#0f172a) + グラデーション
- **カード背景**: `--bg-card` (rgba(41, 55, 79, 0.85)) + Glassmorphism
- **アクセント**:
  - Cyan: `#06b6d4` (The)
  - Gold: `#ffca2d` (Hunt, Next Label)
  - Crimson: `#ef4444` (Alert)
- **ランクカラー**:
  - S: `#ffb869`
  - A: `#5ee9b5`
  - F: `#a3b3ff`

### 5.2 プログレスバー
- **通常**: Cyan -> Blue グラデーション (`#06b6d4` -> `#3963bd`)
- **MaxOver**: 赤系グラデーション
- **ConditionActive**: 枠が白く点滅 (`blink-border-white`)

### 5.3 背景エフェクト
- 上部: `linear-gradient` (Cyan系, 上から下へフェード)
- 右下: `radial-gradient` (Gold系)

## 6. 機能仕様

### 6.1 討伐報告
- **Aランク**: ボタン押下で即時報告（現在時刻）。
- **S/Fランク**: モーダル表示。日時指定可能。
- **バリデーション**: 未来時間や、理論上あり得ない時間の報告時に警告・修正オプションを表示。

### 6.2 マップ・湧き潰し
- Sランクカード展開時にマップ表示。
- 湧き候補地点 (`spawn-point`) をクリックでトグル（未確認/済）。
- **スマホ対応**: 誤操作防止のためダブルタップでトグル。

### 6.3 メンテナンス表示
- **停止中**: カード全体がグレーアウト、操作無効。
- **被り**: カードはグレーアウトするが、報告等の操作は可能。

---
*Last Updated: 2025-12-01*
