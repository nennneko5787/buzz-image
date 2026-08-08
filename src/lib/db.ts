import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { BuzzMedia, BuzzTweet } from "@/lib/types";

/**
 * 収集したツイートの保存先（SQLite）。
 *
 * 以前はアカウントごとの JSON ファイルに丸ごと書き出していたが、
 * 絞り込みは結局「いいね数・日時・アカウント」での問い合わせなので、
 * 素直に 1 つのテーブルに入れて SQL で引くことにした。
 * ファイル全体を読み書きしなくて済むぶん、件数が増えても重くならない。
 *
 * Node 同梱の node:sqlite を使うので、追加の依存はない。
 */

/** 設定のキャッシュ先を絶対パスにする。相対パスはプロジェクトルート基準。 */
export function resolveCacheDir(cacheDir: string): string {
  return path.isAbsolute(cacheDir)
    ? cacheDir
    : // 実行時にしか決まらないパス。バンドラに追跡させない。
      path.join(/* turbopackIgnore: true */ process.cwd(), cacheDir);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tweets (
  id                 TEXT PRIMARY KEY,
  -- 収集したアカウント（小文字）。表示用の綴りは author_username のほう。
  screen_name        TEXT    NOT NULL,
  url                TEXT    NOT NULL,
  text               TEXT    NOT NULL,
  -- 比較と並べ替えのため、日時はエポックミリ秒で持つ
  created_at         INTEGER NOT NULL,
  likes              INTEGER NOT NULL,
  retweets           INTEGER NOT NULL,
  replies            INTEGER NOT NULL,
  quotes             INTEGER NOT NULL,
  views              INTEGER NOT NULL,
  -- media は JSON のまま。件数だけは絞り込みに使うので列に出す。
  media_count        INTEGER NOT NULL,
  media              TEXT    NOT NULL,
  author_name        TEXT    NOT NULL,
  author_username    TEXT    NOT NULL,
  author_avatar_url  TEXT    NOT NULL,
  author_verified    INTEGER NOT NULL,
  possibly_sensitive INTEGER NOT NULL
);

-- 画面からの絞り込み（アカウント・いいね数・期間）をそのまま引けるように
CREATE INDEX IF NOT EXISTS tweets_by_account
  ON tweets (screen_name, likes, created_at);
CREATE INDEX IF NOT EXISTS tweets_by_created_at ON tweets (created_at);

-- アカウントごとの収集状況。ツイート本体とは別に持つ。
CREATE TABLE IF NOT EXISTS pools (
  screen_name TEXT PRIMARY KEY,
  -- 収集条件。日付で動く until: は含めない。
  query       TEXT    NOT NULL,
  -- どこまでの新しさを集めたか（until: の境界）。NULL は制限なし。
  until_at    INTEGER,
  complete    INTEGER NOT NULL,
  cursor      TEXT,
  fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  screen_name TEXT PRIMARY KEY,
  -- 表示に使う綴り（screen_name は小文字にしたキー）
  username    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  avatar_url  TEXT    NOT NULL,
  verified    INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as {
  __buzzDb?: { dir: string; db: DatabaseSync };
};

/**
 * 保存先を開く。スキーマが無ければ作り、旧形式の JSON があれば取り込む。
 * 保存先が変わったときだけ開き直す。
 */
export function getDatabase(cacheDir: string): DatabaseSync {
  const dir = resolveCacheDir(cacheDir);
  const current = globalForDb.__buzzDb;
  if (current?.dir === dir) return current.db;

  current?.db.close();

  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "buzz.db"));
  // 読みながら書けるように。落ちてもデータが壊れにくい。
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  importLegacyPools(db, dir);

  globalForDb.__buzzDb = { dir, db };
  return db;
}

/* ------------------------------------------------------------------ *
 * 旧形式（アカウントごとの JSON）の取り込み
 * ------------------------------------------------------------------ */

/** JSON に書き出していた頃の形 */
interface LegacyPool {
  query: string;
  untilAt?: number | null;
  tweets: BuzzTweet[];
  complete: boolean;
  cursor: string | null;
  fetchedAt: number;
}

const LEGACY_IMPORTED = "legacy_pools_imported";

/**
 * 同じディレクトリに残っている JSON を 1 度だけ読み込む。
 *
 * せっかく集めたぶんを移行で捨てないため。元のファイルは触らない
 * （消さずに残しておけば、何かあったときに戻せる）。
 */
function importLegacyPools(db: DatabaseSync, dir: string): void {
  const done = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(LEGACY_IMPORTED);
  if (done) return;

  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."));

    for (const file of files) {
      const screenName = path.basename(file, ".json");
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        ) as LegacyPool;
        if (!Array.isArray(parsed.tweets)) continue;

        importLegacyPool(db, screenName, parsed);
        console.log(
          `[db] @${screenName} の ${parsed.tweets.length} 件を取り込みました`,
        );
      } catch (error) {
        console.warn(`[db] ${file} の取り込みに失敗:`, error);
      }
    }

    // プロフィールのキャッシュも拾っておく
    importLegacyProfiles(db, dir);
  } catch {
    // ディレクトリが無いなど。取り込むものが無いだけなので続行する。
  }

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    LEGACY_IMPORTED,
    String(Date.now()),
  );
}

function importLegacyPool(
  db: DatabaseSync,
  screenName: string,
  pool: LegacyPool,
): void {
  // until: をクエリに含めていた頃のぶんは、境界を切り出して持ち直す
  const legacy = /^(.*) until:(\d{4})-(\d{2})-(\d{2})$/.exec(pool.query);
  const query = legacy ? legacy[1] : pool.query;
  const untilAt = legacy
    ? new Date(
        Number(legacy[2]),
        Number(legacy[3]) - 1,
        Number(legacy[4]),
      ).getTime()
    : (pool.untilAt ?? null);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tweets (
      id, screen_name, url, text, created_at,
      likes, retweets, replies, quotes, views,
      media_count, media,
      author_name, author_username, author_avatar_url, author_verified,
      possibly_sensitive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const tweet of pool.tweets) {
    const media: BuzzMedia[] = Array.isArray(tweet.media) ? tweet.media : [];
    insert.run(
      tweet.id,
      screenName.toLowerCase(),
      tweet.url,
      tweet.text,
      Date.parse(tweet.createdAt),
      tweet.stats.likes,
      tweet.stats.retweets,
      tweet.stats.replies,
      tweet.stats.quotes,
      tweet.stats.views,
      media.length,
      JSON.stringify(media),
      tweet.author.name,
      tweet.author.username,
      tweet.author.avatarUrl,
      tweet.author.verified ? 1 : 0,
      tweet.possiblySensitive ? 1 : 0,
    );
  }

  db.prepare(
    `INSERT OR REPLACE INTO pools
       (screen_name, query, until_at, complete, cursor, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    screenName.toLowerCase(),
    query,
    untilAt,
    pool.complete ? 1 : 0,
    pool.cursor,
    pool.fetchedAt,
  );
}

interface LegacyProfile {
  screenName?: string;
  name?: string;
  avatarUrl?: string;
  verified?: boolean;
  fetchedAt?: number;
}

function importLegacyProfiles(db: DatabaseSync, dir: string): void {
  let stored: Record<string, LegacyProfile>;
  try {
    stored = JSON.parse(
      fs.readFileSync(path.join(dir, ".profiles.json"), "utf8"),
    ) as Record<string, LegacyProfile>;
  } catch {
    return;
  }

  const insert = db.prepare(
    `INSERT OR REPLACE INTO profiles
       (screen_name, username, name, avatar_url, verified, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const [key, profile] of Object.entries(stored)) {
    if (!profile || typeof profile !== "object") continue;
    insert.run(
      key.toLowerCase(),
      profile.screenName ?? key,
      profile.name ?? "",
      profile.avatarUrl ?? "",
      profile.verified ? 1 : 0,
      profile.fetchedAt ?? Date.now(),
    );
  }
}
