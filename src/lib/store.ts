import "server-only";

import type { DatabaseSync } from "node:sqlite";

import type {
  BuzzMedia,
  BuzzProfile,
  BuzzTweet,
  StoredSort,
} from "@/lib/types";

/**
 * 保存したツイート・収集状況・プロフィールへの問い合わせ。
 *
 * 画面からの絞り込み（アカウント・いいね数・期間・メディアの有無）は
 * すべてここで SQL の WHERE に落とす。全件をメモリに載せて絞る必要はない。
 */

/* ------------------------------------------------------------------ *
 * ツイート
 * ------------------------------------------------------------------ */

/** 保存済みツイートの絞り込み条件 */
export interface TweetFilter {
  /** 対象アカウント（小文字）。空なら 1 件も該当しない。 */
  screenNames: string[];
  /** いいね数の下限（この値を含む） */
  minLikes: number;
  /** この時刻より前の投稿だけ（エポックミリ秒）。null なら期間の制限なし。 */
  until: number | null;
  /** 画像・動画付きだけに絞るか */
  requireMedia: boolean;
}

interface TweetRow {
  id: string;
  url: string;
  text: string;
  created_at: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  media: string;
  author_name: string;
  author_username: string;
  author_avatar_url: string;
  author_verified: number;
  possibly_sensitive: number;
}

const COLUMNS = `
  id, url, text, created_at,
  likes, retweets, replies, quotes, views,
  media,
  author_name, author_username, author_avatar_url, author_verified,
  possibly_sensitive
`;

const ORDER_BY: Record<StoredSort, string> = {
  new: "created_at DESC",
  old: "created_at ASC",
  likes: "likes DESC",
};

function toBuzzTweet(row: TweetRow): BuzzTweet {
  let media: BuzzMedia[] = [];
  try {
    media = JSON.parse(row.media) as BuzzMedia[];
  } catch {
    // 壊れていてもツイート自体は見せる
  }

  return {
    id: row.id,
    url: row.url,
    text: row.text,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    author: {
      name: row.author_name,
      username: row.author_username,
      avatarUrl: row.author_avatar_url,
      verified: Boolean(row.author_verified),
    },
    stats: {
      likes: Number(row.likes),
      retweets: Number(row.retweets),
      replies: Number(row.replies),
      quotes: Number(row.quotes),
      views: Number(row.views),
    },
    media,
    possiblySensitive: Boolean(row.possibly_sensitive),
  };
}

/** 絞り込み条件を WHERE 句に落とす */
function buildWhere(filter: TweetFilter): {
  sql: string;
  params: (string | number)[];
} {
  // アカウントが 1 件も選ばれていないなら、何にも当たらない条件にする
  if (filter.screenNames.length === 0) return { sql: "1 = 0", params: [] };

  const placeholders = filter.screenNames.map(() => "?").join(", ");
  const conditions = [`screen_name IN (${placeholders})`, "likes >= ?"];
  const params: (string | number)[] = [
    ...filter.screenNames,
    filter.minLikes,
  ];

  if (filter.until !== null) {
    conditions.push("created_at < ?");
    params.push(filter.until);
  }
  if (filter.requireMedia) conditions.push("media_count > 0");

  return { sql: conditions.join(" AND "), params };
}

export function countTweets(db: DatabaseSync, filter: TweetFilter): number {
  const where = buildWhere(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM tweets WHERE ${where.sql}`)
    .get(...where.params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

/** アカウントごとの件数。条件に合うものが 0 件のアカウントは含まれない。 */
export function countTweetsByAccount(
  db: DatabaseSync,
  filter: TweetFilter,
): Map<string, number> {
  const where = buildWhere(filter);
  const rows = db
    .prepare(
      `SELECT screen_name, COUNT(*) AS count FROM tweets
        WHERE ${where.sql}
        GROUP BY screen_name`,
    )
    .all(...where.params) as { screen_name: string; count: number }[];

  return new Map(rows.map((row) => [row.screen_name, Number(row.count)]));
}

export function listTweets(
  db: DatabaseSync,
  filter: TweetFilter,
  sort: StoredSort,
  offset: number,
  limit: number,
): BuzzTweet[] {
  const where = buildWhere(filter);
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM tweets
        WHERE ${where.sql}
        ORDER BY ${ORDER_BY[sort]}, id
        LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as unknown as TweetRow[];

  return rows.map(toBuzzTweet);
}

/**
 * 条件に合うものから 1 件無作為に引く。
 *
 * @param excludeId 直前に出したツイート。ほかに候補が無いときは、
 *   何も出せなくなるよりはと、これを引き直す。
 */
export function drawTweet(
  db: DatabaseSync,
  filter: TweetFilter,
  excludeId?: string,
): BuzzTweet | null {
  const where = buildWhere(filter);
  const pick = (extra: string, params: (string | number)[]) =>
    db
      .prepare(
        `SELECT ${COLUMNS} FROM tweets
          WHERE ${where.sql}${extra}
          ORDER BY RANDOM() LIMIT 1`,
      )
      .get(...where.params, ...params) as unknown as TweetRow | undefined;

  const row =
    (excludeId ? pick(" AND id != ?", [excludeId]) : undefined) ??
    pick("", []);

  return row ? toBuzzTweet(row) : null;
}

/** 集めたツイートを保存する。すでにあるものは触らない。 @returns 新しく入った件数 */
export function insertTweets(
  db: DatabaseSync,
  screenName: string,
  tweets: BuzzTweet[],
): number {
  if (tweets.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tweets (
      id, screen_name, url, text, created_at,
      likes, retweets, replies, quotes, views,
      media_count, media,
      author_name, author_username, author_avatar_url, author_verified,
      possibly_sensitive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const key = screenName.toLowerCase();
  let added = 0;

  for (const tweet of tweets) {
    const result = insert.run(
      tweet.id,
      key,
      tweet.url,
      tweet.text,
      Date.parse(tweet.createdAt),
      tweet.stats.likes,
      tweet.stats.retweets,
      tweet.stats.replies,
      tweet.stats.quotes,
      tweet.stats.views,
      tweet.media.length,
      JSON.stringify(tweet.media),
      tweet.author.name,
      tweet.author.username,
      tweet.author.avatarUrl,
      tweet.author.verified ? 1 : 0,
      tweet.possiblySensitive ? 1 : 0,
    );
    added += Number(result.changes);
  }

  return added;
}

/**
 * いちばん新しいツイートの投稿者情報。
 * アイコンと表示名を出すためだけなので、対象期間の外でも構わない。
 */
export function newestAuthor(
  db: DatabaseSync,
  screenName: string,
): BuzzProfile | null {
  const row = db
    .prepare(
      `SELECT author_name, author_username, author_avatar_url, author_verified
         FROM tweets WHERE screen_name = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(screenName.toLowerCase()) as
    | {
        author_name: string;
        author_username: string;
        author_avatar_url: string;
        author_verified: number;
      }
    | undefined;

  if (!row) return null;
  return {
    screenName: row.author_username || screenName,
    name: row.author_name,
    avatarUrl: row.author_avatar_url,
    verified: Boolean(row.author_verified),
  };
}

/* ------------------------------------------------------------------ *
 * 収集状況
 * ------------------------------------------------------------------ */

export interface PoolState {
  /** 収集条件。日付で動く until: は含めない。 */
  query: string;
  /** どこまでの新しさを集めたか（until: の境界）。null は制限なし。 */
  untilAt: number | null;
  /** 全期間を辿り終えているか */
  complete: boolean;
  /** 続きから再開するためのカーソル */
  cursor: string | null;
  fetchedAt: number;
}

export function readPoolState(
  db: DatabaseSync,
  screenName: string,
): PoolState | null {
  const row = db
    .prepare(
      `SELECT query, until_at, complete, cursor, fetched_at
         FROM pools WHERE screen_name = ?`,
    )
    .get(screenName.toLowerCase()) as
    | {
        query: string;
        until_at: number | null;
        complete: number;
        cursor: string | null;
        fetched_at: number;
      }
    | undefined;

  if (!row) return null;
  return {
    query: row.query,
    untilAt: row.until_at === null ? null : Number(row.until_at),
    complete: Boolean(row.complete),
    cursor: row.cursor,
    fetchedAt: Number(row.fetched_at),
  };
}

export function writePoolState(
  db: DatabaseSync,
  screenName: string,
  state: PoolState,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO pools
       (screen_name, query, until_at, complete, cursor, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    screenName.toLowerCase(),
    state.query,
    state.untilAt,
    state.complete ? 1 : 0,
    state.cursor,
    state.fetchedAt,
  );
}

/* ------------------------------------------------------------------ *
 * プロフィール
 * ------------------------------------------------------------------ */

export function findProfile(
  db: DatabaseSync,
  screenName: string,
): BuzzProfile | null {
  const row = db
    .prepare(
      `SELECT username, name, avatar_url, verified
         FROM profiles WHERE screen_name = ?`,
    )
    .get(screenName.toLowerCase()) as
    | {
        username: string;
        name: string;
        avatar_url: string;
        verified: number;
      }
    | undefined;

  if (!row) return null;
  return {
    screenName: row.username || screenName,
    name: row.name,
    avatarUrl: row.avatar_url,
    verified: Boolean(row.verified),
  };
}

export function saveProfiles(
  db: DatabaseSync,
  profiles: BuzzProfile[],
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO profiles
       (screen_name, username, name, avatar_url, verified, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const fetchedAt = Date.now();
  for (const profile of profiles) {
    insert.run(
      profile.screenName.toLowerCase(),
      profile.screenName,
      profile.name,
      profile.avatarUrl,
      profile.verified ? 1 : 0,
      fetchedAt,
    );
  }
}
