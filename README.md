# バズツイートガチャ (buzz-image)

あらかじめ設定しておいたスクリーンネームの中から、**いいねが 1 万以上ついたツイート**をランダムに 1 件表示する Next.js アプリです。ツイートの本文・添付画像・いいね数・リツイート数・リプライ数を表示します。

X のデータ取得には [emusks](https://emusks.tiago.zip/) を使用しています。

## セットアップ

```sh
pnpm install
cp .env.example .env.local   # PowerShell なら: Copy-Item .env.example .env.local
```

`.env.local` の `X_AUTH_TOKEN` に、x.com にログイン中のブラウザの Cookie `auth_token` の値を設定します。

1. [x.com](https://x.com) にログイン
2. DevTools（F12）→ **Application** → **Cookies** → `https://x.com`
3. `auth_token` の値をコピー

```sh
pnpm dev
```

http://localhost:3000 を開くとツイートが 1 件表示されます。ボタンまたは <kbd>Space</kbd> キーで次の 1 件を引けます。

## 表示するアカウントの設定

`src/config/screen-names.ts` の `DEFAULT_SCREEN_NAMES` を書き換えます（`@` は不要）。

```ts
export const DEFAULT_SCREEN_NAMES = [
  "elonmusk",
  "NASA",
  // ...
] as const;
```

環境変数 `SCREEN_NAMES`（カンマ区切り）を設定した場合はそちらが優先されます。

## 環境変数

| 変数                  | 既定値             | 説明                                                                 |
| --------------------- | ------------------ | -------------------------------------------------------------------- |
| `X_AUTH_TOKEN`        | （必須）           | x.com の `auth_token` Cookie                                         |
| `X_CLIENT`            | `web`              | エミュレートするクライアント（`android` / `iphone` など）            |
| `X_PROXY`             | -                  | プロキシ `protocol://user:pass@host:port`                            |
| `SCREEN_NAMES`        | -                  | 対象アカウント（カンマ区切り、@ なし）                               |
| `MIN_LIKES`           | `10000`            | いいね数のしきい値（この値以上）                                     |
| `REQUIRE_IMAGES`      | `true`             | 画像付きツイートに限定するか                                         |
| `UNTIL_MONTHS_AGO`    | -（制限なし）      | 何ヶ月前より古い投稿を対象にするか（小数可。`0.5` = 約 15 日）       |
| `MAX_PAGES`           | `40`               | 全期間を辿るときのページ数の安全上限（1 ページ 40 件）               |
| `PAGE_DELAY_MS`       | `400`              | 列挙中にページ取得の間に空ける時間（レート制限対策）                 |
| `MAX_SYNC_PAGES`      | `10`               | 初回表示のために同期で辿るページ数の上限                             |
| `CACHE_TTL_MS`        | `86400000`         | 候補プールのキャッシュ有効期間（ミリ秒、既定 24 時間）               |
| `CACHE_DIR`           | `.cache/buzz-pools`| 候補プールのディスクキャッシュ先                                     |
| `WEIGHT_BY_POOL_SIZE` | `false`            | `true` でアカウントを候補数で重み付け（全ツイートで一様になる）      |

## 仕組み

抽選は**全期間から一様ランダム**です。新着順・人気順のまま出すことはしていません。

1. アカウントごとに `from:<name> min_faves:10000 filter:images -filter:replies -filter:nativeretweets` で検索し、**カーソルが尽きるまで辿って条件に合うツイートを全期間ぶん列挙**します。
2. 集めきったプールから一様ランダムに 1 件返します。直前に表示したツイートは除外されます。
3. 検索演算子だけに頼らず、サーバー側でもいいね数・画像の有無・投稿者を再検証しています。

初回リクエストで全ページを辿ると待たされるので、**最低 1 件見つかるまで（最大 `MAX_SYNC_PAGES` ページ）同期で取得して即座に返し、残りはバックグラウンドで最後まで辿ります**。収集中は UI に「候補を収集中…」と表示され、その間だけ抽選範囲が新着寄りになります。収集が終わったプールは `.cache/buzz-pools/` に JSON で保存され、プロセスを再起動しても再利用されます（既定 24 時間）。

### 期間を絞る

`UNTIL_MONTHS_AGO` を設定すると、検索クエリに `until:YYYY-MM-DD` が付いて**◯ヶ月前より古い投稿だけ**が対象になります（例: `UNTIL_MONTHS_AGO=3` で「3 ヶ月前より前」の投稿）。最近の投稿を除いて、昔のバズツイートだけを掘り返したいときに使います。その範囲の中で一様ランダムに引かれます。

`until:` が効かなかった場合の保険として、ツイートごとの投稿日時チェックもサーバー側で入れています。

なお `until:` の日付は日単位なので、**日付が変わるとクエリ文字列が変わりキャッシュが作り直されます**（1 日 1 回）。

### アカウントの選び方

既定では**アカウントごとに等確率**です（バズツイートが 3 件のアカウントと 200 件のアカウントが同じ確率）。全アカウントの全ツイートで一様にしたい場合は `WEIGHT_BY_POOL_SIZE=true` にしてください。

## 注意

- emusks は X の非公式（リバースエンジニアリングされた）API を利用します。利用は X の利用規約に反する可能性があり、アカウントが凍結・ロックされるリスクがあります。**捨てアカウントでの利用を推奨します。**
- `X_AUTH_TOKEN` はアカウントへのフルアクセス権を持ちます。`.env.local` はコミットしないでください（`.gitignore` 済み）。
- emusks は内部で cycletls（Go バイナリ）を起動するため、API ルートは Node.js ランタイム固定です。Edge ランタイムや Vercel の Edge Functions では動きません。
