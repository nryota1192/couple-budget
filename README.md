# ふたり家計簿(couple-budget)

同棲費用の管理アプリ。**世帯全体の総額**(月200,000円)を項目別予算として管理し、
「各項目がいくら余ったか」「翌月にいくら繰り越せるか」がスマホで一目でわかる。
折半で一人あたり100,000円。こころさんからりょうたさんへ渡す預かり金(monthlyFund、
基本100,000円で変更可)は設定画面でのみ扱い、メイン画面には表示しない(2026-08-08変更)。

## 仕様サマリ

- 開始月: **2026年8月**。月は暦月で、月が変わると自動確定(締め操作なし)
- 項目10個・予算合計200,000円(世帯総額。家賃84,000/電気10,000/ガス4,000/水道6,000/
  保険4,000/食費56,000/教育費10,000/家電積立10,000/日用品6,000/共通費10,000)
- 予算変更は設定画面から2通り: **「今月以降ずっと」**(setBudgetFrom)と
  **「今月だけ」**(setBudgetForMonth。翌月に元の額へ戻すエントリを自動で足す)
- 繰越は**項目ごと**: `使える額 = 月予算 + 前月繰越`、余りは翌月へ、使いすぎはマイナス繰越
- 固定費(家賃・保険)は毎月自動で全額消化扱い(入力不要)
- 支出には**計上月**(`month`)を持たせ、支払日と別の月の予算から引ける。
  光熱費は請求が翌月に届くため、項目を選ぶと計上月が自動で**前月**になる(何ヶ月でも遡れる)
- 当月の光熱費は「請求待ち」、過去月で未入力のものはホームに「未入力の請求」として一覧表示される
- 支出には**入力者**(`by`)が記録され履歴に表示される。名前は端末ごとの設定(localStorage)で、
  二人が同じ買い物を二重入力したときに気づけるようにするためのもの
- **立替**: 他の人の分を一緒に払ったときは支出に `advance`(立替額)を付けられる。
  立替分は最初から予算に計上しない(`householdAmount()` = amount − advance)ので、
  返金が翌月にずれても繰越が歪まない。未精算の立替は履歴画面の上部に一覧表示され、
  返してもらったら「精算済みにする」(`advanceSettled`)。メイン画面には出さない
- 設定画面からJSONのバックアップを**ダウンロード / 復元**できる。復元は `validateBackup()` を通った
  ファイルのみ受け付け、支出を全置換する(PINは復元後も現在のものを維持しロックアウトを防ぐ)
- 家電積立は支出しない限り残高が積み上がり、家電購入時に支出を入力
- アクセスは共有URL+共通PIN(4〜6桁)。PWA対応でホーム画面に追加可能

## フォルダ構成

```
public/            アプリ本体(静的ファイルのみ・ビルド不要)
  js/logic.js      繰越計算ロジック(純粋関数)
  js/store.js      データ層(localStorage / Firestore 切替)
  js/store-firebase.js  Firestore実装(共有モード)
  js/firebase-config.js Firebase設定(null=ローカルモード)
  js/defaults.js   初期項目マスタ
  js/app.js        画面・ルーティング
tests/             繰越ロジックの単体テスト
firebase.json / firestore.rules  Firebaseデプロイ設定
```

## ローカルで動かす

```
python -m http.server 8741 --directory public
```

→ http://localhost:8741 を開く。**localhost では必ず端末内(localStorage)保存**になり、
本番のFirestoreデータは書き換わらない(`store.js` の `isLocalhost` 判定)。
なお ES Modules はブラウザにキャッシュされるため、変更が反映されない時はポートを変えるか強制リロードする。

## 月末の自動バックアップ

`scripts/backup.mjs` が Firestore のデータを JSON に書き出す。依存パッケージなし
(Firestore の REST API を fetch で叩くだけ)。出力はアプリの「バックアップから復元」が
そのまま読める形式。

```
node scripts/backup.mjs --household <世帯ID> [--dest <保存先>]
```

- **世帯IDは家計簿を開く鍵そのもの。公開リポジトリには絶対に書かない**
  (タスクスケジューラの引数として渡している)
- 保存先は `R:\良太\家計簿`(未割当なら UNC `\\LS210DEAB\share\良太\家計簿` に自動フォールバック)
- ファイル名は `ふたり家計簿-YYYY-MM-DD.json`。過去分は消さない(1ファイル数KB)
- 一時ファイルに書いてから rename し、書き込み後に読み直して件数を検証する
- 実行結果は保存先の `バックアップ実行ログ.txt` と `%LOCALAPPDATA%\couple-budget\backup.log` に追記

### タスクスケジューラ登録内容(2026-08-01 設定済み)

タスク名 **ふたり家計簿バックアップ** / 毎月**末日 13:00** / 実行アカウントはログオン中のユーザー。
`StartWhenAvailable=true` にしてあるので、末日が休日でPCが落ちていても**次にPCを使ったときに実行**される。

再登録が必要になったら `Export-ScheduledTask -TaskName 'ふたり家計簿バックアップ'` で
現在の定義を確認できる(トリガーは `<DaysOfMonth><Day>Last</Day></DaysOfMonth>`)。

## テスト

```
npm test
```

Windows では `node --test tests/` (ディレクトリ指定)が動かないため、
package.json でファイルを明示している。

## 本番構成(セットアップ済み・2026-08-01)

- **Firebase プロジェクト**: `couple-budget-a3812`(無料Sparkプラン、Googleアカウント nryota1192)
  - Firestore: asia-northeast1(東京)、本番モード。ルールは「匿名認証済みのみ読み書き可」で公開済み(`firestore.rules` と同内容)
  - Authentication: 匿名ログインのみ有効
  - Webアプリ `couple-budget-web` の設定値を `public/js/firebase-config.js` に登録済み
- **配信**: GitHub Pages(リポジトリ `nryota1192/couple-budget`、公開)
  - `main` に push すると `.github/workflows/deploy.yml` が `public/` を自動デプロイ
  - URL: https://nryota1192.github.io/couple-budget/

### 使い始め方

1. スマホで https://nryota1192.github.io/couple-budget/ を開き、初回設定でPINを決める
2. 設定画面に出る **共有URL(?h=世帯ID付き)** をパートナーに送り、二人でブックマーク
   (ホーム画面に追加すればアプリのように使える)
3. パートナーは必ず共有URL(?h=付き)から開くこと(素のURLだと別世帯が作られてしまう)

### firebase.json / firestore.rules について

Firebase Hosting は使っていないが、ルールの原本管理とCLIデプロイへの切替用に残してある。

### 注意

- 世帯IDは推測困難なランダムIDで、URLとPINを知っている人だけが使える簡易的な保護。
  URLは二人以外に共有しないこと
- PINを変更すると相手の端末では再入力が求められる
- 設定画面からJSONバックアップをダウンロードできる
