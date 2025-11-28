# The Hunt - プロジェクト仕様書

## 1. プロジェクト概要
FFXIVのモブハント情報を管理・共有するためのWebアプリケーション。
ユーザーはモブの湧き時間、討伐状況、湧き位置などをリアルタイムで確認・報告できる。

### 技術スタック
- **Frontend**: HTML5, CSS3 (Tailwind CSS via CDN), Vanilla JavaScript (ES Modules)
- **Backend**: Firebase (Firestore, Authentication, Cloud Functions)
- **Hosting**: Firebase Hosting (想定)

## 2. ディレクトリ構成
```
/
├── index.html          # メインエントリーポイント
├── style.css           # カスタムスタイル定義
├── mob_data.json       # モブの基本データ（静的）
├── maintenance.json    # メンテナンス情報
├── icon/               # アイコン画像
├── maps/               # マップ画像
└── src/                # JavaScriptソースコード
    ├── app.js          # アプリケーション初期化、イベントハンドリング
    ├── dataManager.js  # 状態管理、データロード、データ加工
    ├── server.js       # Firebase連携 (Auth, Firestore, Functions)
    ├── uiRender.js     # UIレンダリング、DOM操作
    ├── filterUI.js     # フィルタリング機能のUIロジック
    ├── cal.js          # 時間計算、湧き時間算出ロジック
    ├── location.js     # マップ・位置情報関連ロジック
    ├── modal.js        # モーダルウィンドウ制御
    └── tooltip.js      # ツールチップ機能
```

## 3. アーキテクチャ

### 3.1 データフロー
1. **初期化**: `app.js` が `dataManager.js` を呼び出し、`mob_data.json` と `maintenance.json` をロード。
2. **リアルタイム更新**: `server.js` が Firestore のリスナーを設定し、他ユーザーの報告（討伐時間、湧き潰し状況、メモ）を受信。
3. **状態管理**: `dataManager.js` の `state` オブジェクトで一元管理。
4. **描画**: 状態変更をトリガーに `uiRender.js` が画面を更新。

### 3.2 データ構造

#### `mob_data.json` (静的データ)
モブIDをキーとしたオブジェクト。
- `rank`: ランク (S, A, F)
- `name`: モブ名
- `area`: エリア名
- `repopSeconds`: 最短湧き時間 (秒)
- `maxRepopSeconds`: 最長湧き時間 (秒)
- `condition`: 湧き条件テキスト
- `locations`: 湧き候補地点リスト (Sランクなど)

#### Firestore (動的データ)
- **`mob_status` コレクション**:
  - ドキュメント: `s_latest`, `a_latest`, `f_latest`
  - フィールド: モブIDをキーとし、`last_kill_time` (Timestamp) を保持。
- **`mob_locations` コレクション**:
  - ドキュメント: モブID
  - フィールド: 湧き地点IDごとのステータス (湧き潰し状況)。
- **`shared_data/memo` ドキュメント**:
  - フィールド: モブIDごとのメモ情報。

## 4. 主な機能とロジック

### 4.1 討伐報告 (Report)
- ユーザーは「報告」ボタンまたはモーダルから討伐時間を報告。
- **バリデーション**:
  - `server.js` にて、前回の討伐時間やメンテナンス明け時間を考慮し、理論上湧き得ない時間の報告を警告。
  - 「強制送信」チェックボックスでオーバーライド可能。
- **処理**: Cloud Functions (`updateMobStatusV2`) を経由してデータを更新。

### 4.2 湧き時間計算
- `cal.js` (推測) および `dataManager.js` にて計算。
- メンテナンス明けの場合は、サーバー稼働開始時間を基準に計算（初回湧き短縮ロジック含む）。

### 4.3 フィルタリング
- ランク別 (S, A, F, ALL)
- エリア別 (拡張パッチごと)
- `filterUI.js` で制御し、`localStorage` に設定を保存。

### 4.4 UI/UX
- **プログレスバー**: 湧きまでの時間を視覚化。状態に応じて色や点滅 (Condition Active) を変化。
- **モブカード**:
  - Sランクは展開可能で、詳細情報（マップ、湧き条件、メモ）を表示。
  - A/Fランクはコンパクト表示。
- **レスポンシブ**: PCとモバイルでレイアウトを最適化。

## 5. 開発・運用ルール
- **コード規約**: ES Modulesを使用。グローバル汚染を避ける。
- **デザイン**: Tailwind CSS を基本とし、必要に応じて `style.css` で補完。
- **デプロイ**: 静的ファイルとしてホスティング可能だが、Firebase Functions との連携が必要。

---
*この仕様書は 2025-11-28 時点のコードベースに基づいています。*
