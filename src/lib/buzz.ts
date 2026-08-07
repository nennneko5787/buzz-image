import "server-only";

import type { EmusksMedia, EmusksTweet } from "emusks";

import { getEmusksClient } from "@/lib/emusks-client";
import { EnumerationGate, mapWithConcurrency } from "@/lib/enumeration-gate";
import { readStoredPool, writeStoredPool } from "@/lib/pool-cache";
import { getSettings, resolveScreenNames } from "@/lib/settings";
import {
  type AppSettings,
  formatSearchDate,
  getUntilDate,
  resolveMinLikes,
} from "@/lib/settings-schema";
import type { BuzzMedia, BuzzMediaKind, BuzzTweet } from "@/lib/types";

interface PoolEntry {
  query: string;
  tweets: BuzzTweet[];
  /** 全期間を辿り終えているか */
  complete: boolean;
  /** 続きから再開するためのカーソル */
  cursor: string | null;
  fetchedAt: number;
  /** 進行中の列挙。同じアカウントを二重に辿らないためのロック */
  enumerating?: Promise<void>;
  /** 列挙が失敗したとき、この時刻までは再開しない（レート制限対策） */
  retryAfter?: number;
}

/** 読み込んだプールと、そのうち指定のしきい値を満たすツイート */
interface LoadedPool {
  entry: PoolEntry;
  matched: BuzzTweet[];
}

/** 列挙が失敗してから再開するまでの待ち時間 */
const RETRY_DELAY_MS = 60 * 1000;

const globalForPool = globalThis as unknown as {
  __buzzPool?: Map<string, PoolEntry>;
  __buzzGate?: EnumerationGate;
};

const pool: Map<string, PoolEntry> = (globalForPool.__buzzPool ??= new Map());

/** バックグラウンドで走る列挙の同時実行数を抑えるゲート */
const gate: EnumerationGate = (globalForPool.__buzzGate ??=
  new EnumerationGate());

/**
 * 検索クエリを組み立てる。
 *
 * ここで使うのは常に下限の `minLikes`。ユーザー指定のしきい値を混ぜると
 * 値ごとにプールを作り直すことになるので、絞り込みは抽選時に行う。
 */
export function buildQuery(
  screenName: string,
  settings: AppSettings,
): string {
  const parts = [
    `from:${screenName}`,
    `min_faves:${settings.minLikes}`,
    "-filter:replies",
    "-filter:nativeretweets",
  ];
  if (settings.requireImages) parts.push("filter:images");

  const until = getUntilDate(settings.untilMonthsAgo);
  if (until) parts.push(`until:${formatSearchDate(until)}`);

  return parts.join(" ");
}

function pickMediaKind(media: EmusksMedia): BuzzMediaKind {
  if (media.type === "animated_gif") return "gif";
  if (media.type === "video") return "video";
  return "photo";
}

function toBuzzMedia(media: EmusksMedia): BuzzMedia | null {
  const base = media.media_url_https;
  if (!base) return null;

  const kind = pickMediaKind(media);
  const large = media.sizes?.large;
  const width = media.original_info?.width ?? large?.w ?? 1200;
  const height = media.original_info?.height ?? large?.h ?? 675;

  return {
    kind,
    // 写真は name=large で元サイズに近い画像を取る（動画サムネイルはそのまま）
    url: kind === "photo" ? `${base}?format=jpg&name=large` : base,
    width,
    height,
    alt: media.ext_alt_text,
    durationSec: media.video_info?.duration_millis
      ? Math.round(media.video_info.duration_millis / 1000)
      : undefined,
  };
}

/**
 * full_text から t.co を展開し、末尾に付くメディアの短縮 URL を取り除く。
 */
function buildDisplayText(tweet: EmusksTweet): string {
  let text = tweet.text ?? "";

  for (const media of tweet.media ?? []) {
    if (media.url) text = text.split(media.url).join("");
  }

  for (const entity of tweet.urls ?? []) {
    if (entity.url && entity.expanded_url) {
      text = text.split(entity.url).join(entity.expanded_url);
    }
  }

  return decodeHtmlEntities(text).trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function toBuzzTweet(tweet: EmusksTweet): BuzzTweet | null {
  const user = tweet.user;
  if (!user) return null;

  const media = (tweet.media ?? [])
    .map(toBuzzMedia)
    .filter((m): m is BuzzMedia => m !== null);

  return {
    id: tweet.id,
    url: `https://x.com/${user.username}/status/${tweet.id}`,
    text: buildDisplayText(tweet),
    createdAt: new Date(tweet.created_at).toISOString(),
    author: {
      name: user.name,
      username: user.username,
      avatarUrl: user.profile_picture?.url ?? "",
      verified: Boolean(
        user.verification?.verified || user.verification?.premium_verified,
      ),
    },
    stats: {
      likes: tweet.stats?.likes ?? 0,
      retweets: tweet.stats?.retweets ?? 0,
      replies: tweet.stats?.replies ?? 0,
      quotes: tweet.stats?.quotes ?? 0,
      views: tweet.stats?.views ?? 0,
    },
    media,
    possiblySensitive: Boolean(tweet.misc?.possibly_sensitive),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 検索結果 1 ページ分をプールに取り込む。
 * 検索演算子だけに頼らず、いいね数・画像の有無・投稿者はこちらでも検証する。
 *
 * @returns 新しく追加された件数
 */
function mergePage(
  entry: PoolEntry,
  screenName: string,
  rawTweets: EmusksTweet[],
  settings: AppSettings,
): number {
  const seen = new Set(entry.tweets.map((t) => t.id));
  const until = getUntilDate(settings.untilMonthsAgo)?.getTime();
  let added = 0;

  for (const raw of rawTweets) {
    const tweet = toBuzzTweet(raw);
    if (!tweet) continue;
    if (seen.has(tweet.id)) continue;
    if (tweet.stats.likes < settings.minLikes) continue;
    if (settings.requireImages && tweet.media.length === 0) continue;
    // until: が効かなかった場合の保険。指定日より新しい投稿は除外する。
    if (until !== undefined && new Date(tweet.createdAt).getTime() >= until) {
      continue;
    }
    // 検索の from: はリツイート等で他人の投稿が混ざることがあるので念のため確認
    if (tweet.author.username.toLowerCase() !== screenName.toLowerCase()) {
      continue;
    }
    seen.add(tweet.id);
    entry.tweets.push(tweet);
    added += 1;
  }

  return added;
}

/** 検索を 1 ページ進める。カーソルが尽きたら complete を立てる。 */
async function fetchNextPage(
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
): Promise<void> {
  const client = await getEmusksClient();
  const result = await client.search.latest(entry.query, {
    count: 40,
    // null を渡すと GraphQL variables に cursor: null が乗るので undefined にする
    cursor: entry.cursor ?? undefined,
  });

  mergePage(entry, screenName, result.tweets, settings);
  entry.cursor = result.nextCursor;

  // カーソルが尽きた or 空ページに当たったら辿り終えたとみなす
  if (!result.nextCursor || result.tweets.length === 0) {
    entry.complete = true;
  }
}

/**
 * 残りのページを最後まで辿る（＝全期間ぶんを列挙する）。
 * 初回表示を待たせないため、バックグラウンドで走らせる想定。
 *
 * 同時に走る本数は {@link gate} が制限する。上限に達しているあいだは
 * ここで順番待ちになる。
 */
async function enumerateRest(
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
): Promise<void> {
  gate.setLimit(settings.maxConcurrentEnumerations);
  await gate.acquire();

  try {
    // 順番待ちのあいだに設定が変わってプールが作り直されていたら、
    // 古いほうを辿り続けても意味がないのでやめる
    if (pool.get(screenName.toLowerCase()) !== entry) return;

    for (
      let page = 0;
      page < settings.maxPages && !entry.complete;
      page += 1
    ) {
      if (settings.pageDelayMs > 0) await sleep(settings.pageDelayMs);
      try {
        await fetchNextPage(entry, screenName, settings);
      } catch (error) {
        // レート制限などで失敗したら、集まったぶんとカーソルは残して打ち切る。
        // しばらく間を空けてから、次のリクエストで続きから再開する。
        console.warn(`[buzz] @${screenName} の列挙を中断:`, error);
        entry.retryAfter = Date.now() + RETRY_DELAY_MS;
        break;
      }
    }
  } finally {
    gate.release();
  }

  await writeStoredPool(screenName, settings.cacheDir, {
    query: entry.query,
    tweets: entry.tweets,
    complete: entry.complete,
    cursor: entry.cursor,
    fetchedAt: entry.fetchedAt,
  });
}

/** まだ全期間を辿り終えていなければ、バックグラウンドで続きを取りに行く */
function continueEnumerationInBackground(
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
): void {
  if (entry.complete || entry.enumerating) return;
  if (entry.retryAfter && Date.now() < entry.retryAfter) return;
  entry.retryAfter = undefined;
  entry.enumerating = enumerateRest(entry, screenName, settings).finally(() => {
    entry.enumerating = undefined;
  });
}

/**
 * 1 アカウント分の候補プールを用意する。
 *
 * - メモリ →ディスクの順にキャッシュを見る
 * - 何もなければ 1 ページだけ同期で取得して即座に返す（初回表示を待たせない）
 * - 残りのページはバックグラウンドで最後まで辿る
 */
async function getPool(
  screenName: string,
  settings: AppSettings,
): Promise<PoolEntry> {
  const key = screenName.toLowerCase();
  const query = buildQuery(screenName, settings);

  let entry = pool.get(key);

  // 検索条件が変わっていたらキャッシュを捨てる
  if (entry && entry.query !== query) entry = undefined;
  if (entry && Date.now() - entry.fetchedAt >= settings.cacheTtlMs) {
    entry = undefined;
  }

  if (!entry) {
    const stored = await readStoredPool(screenName, settings.cacheDir);
    if (
      stored &&
      stored.query === query &&
      Date.now() - stored.fetchedAt < settings.cacheTtlMs
    ) {
      entry = {
        query,
        tweets: stored.tweets,
        complete: stored.complete,
        cursor: stored.cursor,
        fetchedAt: stored.fetchedAt,
      };
    }
  }

  if (!entry) {
    entry = {
      query,
      tweets: [],
      complete: false,
      cursor: null,
      fetchedAt: Date.now(),
    };
    // すぐ表示できるよう、最低 1 件見つかるまで同期で辿る。
    // 期間指定などで先頭ページに該当が 0 件のことがあるため 1 ページで打ち切らない。
    for (let page = 0; page < settings.maxSyncPages; page += 1) {
      await fetchNextPage(entry, screenName, settings);
      if (entry.tweets.length > 0 || entry.complete) break;
    }
  }

  pool.set(key, entry);
  continueEnumerationInBackground(entry, screenName, settings);
  return entry;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class NoTweetFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoTweetFoundError";
  }
}

export interface RandomTweetResult {
  tweet: BuzzTweet;
  /** 抽選に使ったスクリーンネーム */
  screenName: string;
  /** そのアカウントの候補ツイート数（指定のしきい値を満たすもの） */
  poolSize: number;
  /** そのアカウントの全期間を辿り終えているか（false の間は収集中） */
  poolComplete: boolean;
  /** 実際に使った抽選条件 */
  criteria: { minLikes: number; requireImages: boolean };
}

/** 候補数で重み付けして 1 アカウント選ぶ */
function pickWeighted(entries: { screenName: string; size: number }[]) {
  const total = entries.reduce((sum, e) => sum + e.size, 0);
  let r = Math.random() * total;
  for (const entry of entries) {
    r -= entry.size;
    if (r < 0) return entry.screenName;
  }
  return entries[entries.length - 1].screenName;
}

/**
 * 設定済みのスクリーンネームからランダムに 1 件バズツイートを選ぶ。
 *
 * 候補プールは全期間ぶんを列挙したものなので、新着に偏らず一様に選ばれる。
 * ただし収集が終わるまでの数リクエストは、まだ集まっている範囲からの抽選になる。
 *
 * @param excludeId 直前に表示したツイート ID（同じものを続けて出さない）
 * @param minLikes いいね数のしきい値。プールは設定の下限で作られているので、
 *   それより低い値を渡しても下限に丸められる。
 */
export async function getRandomBuzzTweet(
  excludeId?: string,
  minLikes?: string | number | null,
): Promise<RandomTweetResult> {
  const settings = await getSettings();
  const threshold = resolveMinLikes(minLikes, settings.minLikes);
  const criteria = {
    minLikes: threshold,
    requireImages: settings.requireImages,
  };

  const screenNames = resolveScreenNames(settings);
  if (screenNames.length === 0) {
    throw new NoTweetFoundError("スクリーンネームが 1 件も設定されていません。");
  }

  // 認証エラーはアカウントを変えても直らないので、ここで先に弾く
  await getEmusksClient();

  const errors = new Set<string>();
  /** 読み込んだプールと、そのうちしきい値を満たすツイート */
  const pools = new Map<string, LoadedPool>();

  const loadPool = async (screenName: string): Promise<LoadedPool | null> => {
    try {
      const entry = await getPool(screenName, settings);
      const loaded: LoadedPool = {
        entry,
        matched:
          threshold <= settings.minLikes
            ? entry.tweets
            : entry.tweets.filter((t) => t.stats.likes >= threshold),
      };
      pools.set(screenName, loaded);
      return loaded;
    } catch (error) {
      errors.add(`@${screenName}: ${(error as Error).message}`);
      return null;
    }
  };

  const draw = (screenName: string, loaded: LoadedPool): RandomTweetResult => {
    const { entry, matched } = loaded;
    const candidates =
      matched.length > 1 ? matched.filter((t) => t.id !== excludeId) : matched;
    const tweet = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      tweet,
      screenName,
      poolSize: matched.length,
      poolComplete: entry.complete,
      criteria,
    };
  };

  if (settings.weightByPoolSize) {
    // 全アカウントのプールを用意し、候補数で重み付けして選ぶ
    // （＝全アカウントの全ツイートの中で一様）。
    // ここも同時に走る数は列挙の上限に合わせて絞る。
    await mapWithConcurrency(
      screenNames,
      settings.maxConcurrentEnumerations,
      loadPool,
    );

    const weights = [...pools.entries()]
      .filter(([, { matched }]) => matched.length > 0)
      .map(([screenName, { matched }]) => ({
        screenName,
        size: matched.length,
      }));

    if (weights.length > 0) {
      const screenName = pickWeighted(weights);
      return draw(screenName, pools.get(screenName)!);
    }
  } else {
    // アカウントをシャッフルして、ヒットするまで順に試す（アカウントごとに等確率）
    for (const screenName of shuffle(screenNames)) {
      const loaded = await loadPool(screenName);
      if (!loaded || loaded.matched.length === 0) continue;
      return draw(screenName, loaded);
    }
  }

  if (errors.size > 0) {
    throw new Error([...errors].join(" / "));
  }

  throw new NoTweetFoundError(
    `条件（いいね ${threshold.toLocaleString("ja-JP")} 以上${
      settings.requireImages ? " / 画像付き" : ""
    }）に合うツイートが見つかりませんでした。`,
  );
}
