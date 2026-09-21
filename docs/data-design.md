# Self Pause データ設計

## 1. 保存方式

初期版ではブラウザのlocalStorageを使用する。
推奨キー:

- `selfPause.appState`

## 2. データ例

```json
{
  "schemaVersion": 1,
  "currentState": "LOCKED",
  "lastStateChangedAt": "2026-09-21T10:45:00+09:00",
  "activeSession": null,
  "activities": [
    {
      "id": "activity-game",
      "name": "ゲーム",
      "type": "default",
      "isDeleted": false,
      "createdAt": "2026-09-21T00:00:00+09:00",
      "updatedAt": "2026-09-21T00:00:00+09:00"
    },
    {
      "id": "activity-reading",
      "name": "読書",
      "type": "custom",
      "isDeleted": false,
      "createdAt": "2026-09-21T01:00:00+09:00",
      "updatedAt": "2026-09-21T01:00:00+09:00"
    }
  ],
  "history": [
    {
      "id": "history-001",
      "activityId": "activity-game",
      "activityNameSnapshot": "ゲーム",
      "startTime": "2026-09-21T10:00:00+09:00",
      "endTime": "2026-09-21T10:45:00+09:00",
      "durationSeconds": 2700,
      "createdAt": "2026-09-21T10:45:00+09:00"
    }
  ],
  "settings": {
    "historyRetentionDays": 365,
    "countdownSeconds": 10
  }
}
```

## 3. フィールド仕様

### appState

- `schemaVersion`: データ構造のバージョン
- `currentState`: 最後に確定した状態。`LOCKED`または`UNLOCKED`
- `lastStateChangedAt`: 最後に状態が確定した日時
- `activeSession`: 現在の活動セッション。通常は使用可能状態中に存在する
- `activities`: 活動項目一覧
- `history`: 活動履歴
- `settings`: アプリ設定

### activeSession

```json
{
  "startedAt": "2026-09-21T10:00:00+09:00"
}
```

活動内容は終了後に選択するため、セッション開始時点では活動名を必須にしない。

### history

- `activityId`: 活動項目ID
- `activityNameSnapshot`: 保存時点の活動名。活動項目削除後も履歴表示を可能にする
- `startTime`: 使用可能状態へ移行した時刻
- `endTime`: 使用禁止状態へ移行した時刻
- `durationSeconds`: 経過秒数
- `createdAt`: 履歴作成日時

## 4. 保存・削除ルール

- 履歴は作成時またはアプリ起動時に、`endTime`から365日を超えたものを削除する。
- 個別削除と一括削除を実装する。
- localStorageの容量不足・JSON破損時には、ユーザーに復旧不能の可能性を通知する。
- 活動項目を削除しても、履歴の`activityNameSnapshot`は保持する。

## 5. セキュリティ・プライバシー

- 初期版ではデータを外部サーバーへ送信しない。
- 端末・ブラウザのデータ消去で履歴が失われる可能性があることを設定画面などで説明する。

## 6. 実装メモ: カレンダー連動プログラムとの互換性

実装（`js/history.js`）では、`history`配列の各エントリのフィールド名を、
このリポジトリの「カレンダー連動プログラム」（`class.js`のEventクラス、および
`register_console`が作成するイベントデータ）がそのまま読めるように、本セクション冒頭の
例から次のようにリネームしている。

| このデータ設計の例 | 実装での名前 | 備考 |
|---|---|---|
| `startTime` | `date_start` | カレンダー連動プログラムのEvent/APIと同じキー名 |
| `endTime` | `date_end` | 同上 |
| `activityNameSnapshot` | `title` | 同上（活動名のスナップショットをそのままtitleとして使う） |
| （なし） | `description` | 追加。カレンダー連動プログラムのEventが持つ任意フィールド |
| （なし） | `color` | 追加。カレンダー連動プログラムの`colorCodes`と同じ数値文字列（`js/colors.js`参照） |

`activityId` / `durationSeconds` / `createdAt`はSelf Pause独自の付加情報としてそのまま保持する。

日時は`Date.prototype.toISOString()`（UTCの`...Z`形式）で保存する。これは本セクション冒頭の
例が示す`+09:00`形式ではなく、カレンダー連動プログラム側が`JSON.stringify(new Date(...))`で
実際に保存している形式（UTC ISO文字列）に合わせたもの。`new Date(...)`でどちらの形式も
問題なくパースできるため、実質的な互換性に影響はない。

この結果、Self Pauseの履歴エントリは `{id, title, description, date_start, date_end, color}`
の形で、カレンダー連動プログラムの予定作成フロー（`register_console`が送信するデータや
`stored_events`）へそのまま渡せる形になっている。ただし両アプリは別プロジェクトの
静的サイトであり、localStorageはオリジン（スキーム+ホスト+ポート）単位で分離されるため、
実際に同じlocalStorageを共有して自動反映されるのは、両アプリを同一オリジン配下
（例: 同じドメインの別パス）にホストした場合に限られる。それ以外の場合は、この
フィールド形式のまま値をエクスポートし、カレンダー連動プログラム側の`stored_events`や
予定作成APIへ渡すことで取り込める。
