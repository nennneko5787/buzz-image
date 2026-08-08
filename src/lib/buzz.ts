import "server-only";

import type { DatabaseSync } from "node:sqlite";

import type { EmusksMedia, EmusksTweet } from "emusks";

import { getDatabase } from "@/lib/db";
import { getEmusksClient } from "@/lib/emusks-client";
import { EnumerationGate, mapWithConcurrency } from "@/lib/enumeration-gate";
import { getSettings, resolveScreenNames } from "@/lib/settings";
import {
  type AppSettings,
  formatSearchDate,
  getUntilDate,
  resolveMinLikes,
} from "@/lib/settings-schema";
import {
  type PoolState,
  type TweetFilter,
  countTweets,
  countTweetsByAccount,
  drawTweet,
  findProfile,
  insertTweets,
  listTweets,
  newestAuthor,
  readPoolState,
  saveProfiles,
  writePoolState,
} from "@/lib/store";
import {
  type BuzzAccount,
  type BuzzMedia,
  type BuzzMediaKind,
  type BuzzProfile,
  type BuzzTweet,
  STORED_PAGE_SIZE,
  type StoredSort,
  type StoredTweetsResponse,
} from "@/lib/types";

/**
 * ツイートそのものは SQLite に入れてある（{@link file://./store.ts}）。
 * ここが持つのは「どこまで集めたか」という収集の進み具合だけで、
 * 表示に使うぶんはそのつど SQL で引く。
 */
interface PoolEntry extends PoolState {
  /** 進行中の収集。同じアカウントを二重に辿らないためのロック */
  enumerating?: Promise<void>;
  /** 収集が失敗したとき、この時刻までは再開しない（レート制限対策） */
  retryAfter?: number;
}

/** 収集が失敗してから再開するまでの待ち時間 */
const RETRY_DELAY_MS = 60 * 1000;

const globalForPool = globalThis as unknown as {
  __buzzPool?: Map<string, PoolEntry>;
  __buzzGate?: EnumerationGate;
};

const pool: Map<string, PoolEntry> = (globalForPool.__buzzPool ??= new Map());

/** バックグラウンドで走る収集の同時実行数を抑えるゲート */
const gate: EnumerationGate = (globalForPool.__buzzGate ??=
  new EnumerationGate());

/**
 * 収集条件（＝どこまで集め直すかの同一性）を表すクエリを組み立てる。
 *
 * ここで使うのは常に下限の `minLikes`。ユーザー指定のしきい値を混ぜると
 * 値ごとに集め直すことになるので、絞り込みは見せる直前に行う。
 *
 * 対象期間（`until:`）も同じ理由でここには入れない。境界は毎日ずれていくので、
 * 混ぜてしまうと日付が変わるたびに全部集め直すことになる。
 * 実際の検索に付けるのは {@link buildSearchQuery} の役目。
 */
export function buildQuery(screenName: string, settings: AppSettings): string {
  const parts = [
    `from:${screenName}`,
    `min_faves:${settings.minLikes}`,
    "-filter:replies",
    "-filter:nativeretweets",
  ];
  if (settings.requireImages) parts.push("filter:images");

  return parts.join(" ");
}

/** 実際に X へ投げるクエリ。対象期間の上限だけを足す。 */
function buildSearchQuery(query: string, until: Date | null): string {
  return until ? `${query} until:${formatSearchDate(until)}` : query;
}

/**
 * 対象期間の境界を比べるための値。
 * 「制限なし」はいちばん新しい側なので +∞ として扱う。
 */
function boundaryOf(untilAt: number | null): number {
  return untilAt ?? Number.POSITIVE_INFINITY;
}

/**
 * いまの設定での絞り込み条件。
 *
 * 保存したツイートは条件を変えても消さないので（また戻したときに使い回せる）、
 * 見せる直前にこの条件で SQL から引き直す。
 */
function buildFilter(
  settings: AppSettings,
  screenNames: string[],
  minLikes: number,
): TweetFilter {
  return {
    screenNames: screenNames.map((name) => name.toLowerCase()),
    minLikes,
    until: getUntilDate(settings.untilMonthsAgo)?.getTime() ?? null,
    requireMedia: settings.requireImages,
  };
}

/* ------------------------------------------------------------------ *
 * X から返ってきたものを、こちらの形に直す
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * 収集
 * ------------------------------------------------------------------ */

/**
 * 検索結果 1 ページ分を保存する。
 * 検索演算子だけに頼らず、いいね数・画像の有無・投稿者はこちらでも検証する。
 *
 * @returns 新しく保存した件数
 */
function storePage(
  db: DatabaseSync,
  screenName: string,
  rawTweets: EmusksTweet[],
  settings: AppSettings,
  until: Date | null,
): number {
  const tweets: BuzzTweet[] = [];

  for (const raw of rawTweets) {
    const tweet = toBuzzTweet(raw);
    if (!tweet) continue;
    if (tweet.stats.likes < settings.minLikes) continue;
    if (settings.requireImages && tweet.media.length === 0) continue;
    // until: が効かなかった場合の保険。指定日より新しい投稿は除外する。
    if (until && Date.parse(tweet.createdAt) >= until.getTime()) continue;
    // 検索の from: はリツイート等で他人の投稿が混ざることがあるので念のため確認
    if (tweet.author.username.toLowerCase() !== screenName.toLowerCase()) {
      continue;
    }
    tweets.push(tweet);
  }

  return insertTweets(db, screenName, tweets);
}

/** 古い側へ検索を 1 ページ進める。カーソルが尽きたら complete を立てる。 */
async function fetchNextPage(
  db: DatabaseSync,
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
  until: Date | null,
): Promise<void> {
  const client = await getEmusksClient();
  const result = await client.search.latest(
    buildSearchQuery(entry.query, until),
    {
      count: 40,
      // null を渡すと GraphQL variables に cursor: null が乗るので undefined にする
      cursor: entry.cursor ?? undefined,
    },
  );

  storePage(db, screenName, result.tweets, settings, until);
  entry.cursor = result.nextCursor;

  // カーソルが尽きた or 空ページに当たったら辿り終えたとみなす
  if (!result.nextCursor || result.tweets.length === 0) {
    entry.complete = true;
  }
}

/** そのアカウントに、まだ取り込んでいない新しい側が残っているか */
function needsHeadRefresh(entry: PoolEntry, until: Date | null): boolean {
  return boundaryOf(until?.getTime() ?? null) > boundaryOf(entry.untilAt);
}

/**
 * 新しい側を取り込み直す。
 *
 * 対象期間の境界（`until:`）は日が経つほど前に進むので、そのぶん新しく対象に
 * 入ったツイートを足しにいく。境界の手前から新しい順に辿り、既知のものしか
 * 出てこなくなった時点で打ち切るので、ふつうは 1 ページで済む。
 */
async function refreshHead(
  db: DatabaseSync,
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
  until: Date | null,
): Promise<void> {
  const query = buildSearchQuery(entry.query, until);
  let cursor: string | undefined;

  for (let page = 0; page < settings.maxPages; page += 1) {
    if (page > 0 && settings.pageDelayMs > 0) await sleep(settings.pageDelayMs);

    const client = await getEmusksClient();
    const result = await client.search.latest(query, { count: 40, cursor });
    const added = storePage(db, screenName, result.tweets, settings, until);

    // 既知のものしか出てこなくなったら、そこから古い側はもう持っている
    if (added === 0 || !result.nextCursor || result.tweets.length === 0) break;
    cursor = result.nextCursor;
  }

  // ここまで来られたら、この境界までは集めたことになる
  entry.untilAt = until?.getTime() ?? null;
}

/**
 * 足りないぶんを集める。
 *
 * 1. 対象期間の境界が進んでいれば、新しく対象になったぶんを取り込む
 * 2. まだ全期間を辿り終えていなければ、続きを最後まで辿る
 *
 * 初回表示を待たせないため、バックグラウンドで走らせる想定。
 * 同時に走る本数は {@link gate} が制限する。上限に達しているあいだは
 * ここで順番待ちになる。
 */
async function updatePool(
  db: DatabaseSync,
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
  until: Date | null,
): Promise<void> {
  gate.setLimit(settings.maxConcurrentEnumerations);
  await gate.acquire();

  try {
    // 順番待ちのあいだに設定が変わって作り直されていたら、
    // 古いほうを辿り続けても意味がないのでやめる
    if (pool.get(screenName.toLowerCase()) !== entry) return;

    // レート制限などで失敗したら、集まったぶんとカーソルは残して打ち切る。
    // しばらく間を空けてから、次のリクエストで続きから再開する。
    try {
      if (needsHeadRefresh(entry, until)) {
        await refreshHead(db, entry, screenName, settings, until);
        writePoolState(db, screenName, entry);
      }

      for (
        let page = 0;
        page < settings.maxPages && !entry.complete;
        page += 1
      ) {
        if (settings.pageDelayMs > 0) await sleep(settings.pageDelayMs);
        await fetchNextPage(db, entry, screenName, settings, until);
        writePoolState(db, screenName, entry);
      }
    } catch (error) {
      console.warn(`[buzz] @${screenName} の収集を中断:`, error);
      entry.retryAfter = Date.now() + RETRY_DELAY_MS;
    }
  } finally {
    gate.release();
  }

  writePoolState(db, screenName, entry);
}

/** 足りないぶんがあれば、バックグラウンドで取りに行く */
function updatePoolInBackground(
  db: DatabaseSync,
  entry: PoolEntry,
  screenName: string,
  settings: AppSettings,
  until: Date | null,
): void {
  if (entry.complete && !needsHeadRefresh(entry, until)) return;
  if (entry.enumerating) return;
  if (entry.retryAfter && Date.now() < entry.retryAfter) return;
  entry.retryAfter = undefined;
  entry.enumerating = updatePool(db, entry, screenName, settings, until).finally(
    () => {
      entry.enumerating = undefined;
    },
  );
}

/**
 * 1 アカウント分の収集状況を用意する。
 *
 * - メモリ →保存済みの順に見る
 * - 何もなければ 1 件見つかるまで同期で取得して即座に返す（初回表示を待たせない）
 * - 足りないぶん（新しく対象に入ったぶん・まだ辿っていない古い側）は
 *   バックグラウンドで取りに行く
 */
async function getPool(
  screenName: string,
  settings: AppSettings,
): Promise<PoolEntry> {
  const db = getDatabase(settings.cacheDir);
  const key = screenName.toLowerCase();
  const query = buildQuery(screenName, settings);
  const until = getUntilDate(settings.untilMonthsAgo);

  let entry = pool.get(key);

  // 収集条件が変わっていたら、集め直しとして扱う
  // （集めたツイート自体は残る。条件を戻せばそのまま使える。）
  if (entry && entry.query !== query) entry = undefined;
  if (entry && Date.now() - entry.fetchedAt >= settings.cacheTtlMs) {
    entry = undefined;
  }

  if (!entry) {
    const stored = readPoolState(db, key);
    if (
      stored &&
      stored.query === query &&
      Date.now() - stored.fetchedAt < settings.cacheTtlMs
    ) {
      entry = { ...stored };
    }
  }

  if (!entry) {
    entry = {
      query,
      // これから集めるので、まだ何も持っていないところから始める
      untilAt: until?.getTime() ?? null,
      complete: false,
      cursor: null,
      fetchedAt: Date.now(),
    };

    // すぐ表示できるよう、最低 1 件見つかるまで同期で辿る。
    // 期間指定などで先頭ページに該当が 0 件のことがあるため 1 ページで打ち切らない。
    const filter = buildFilter(settings, [key], settings.minLikes);
    for (let page = 0; page < settings.maxSyncPages; page += 1) {
      await fetchNextPage(db, entry, screenName, settings, until);
      if (entry.complete || countTweets(db, filter) > 0) break;
    }
    writePoolState(db, screenName, entry);
  }

  pool.set(key, entry);
  updatePoolInBackground(db, entry, screenName, settings, until);
  return entry;
}

/* ------------------------------------------------------------------ *
 * 抽選
 * ------------------------------------------------------------------ */

/**
 * 抽選・一覧の対象にするスクリーンネームを決める。
 *
 * 画面から選ばれた名前は、設定に載っているものだけを通す。
 * {@link requested} が null（＝指定なし）のときは設定の全アカウント。
 */
function selectScreenNames(
  settings: AppSettings,
  requested?: string[] | null,
): string[] {
  const all = resolveScreenNames(settings);
  if (!requested) return all;

  const wanted = new Set(
    requested
      .map((name) => name.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  );
  return all.filter((name) => wanted.has(name.toLowerCase()));
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

export interface RandomTweetOptions {
  /** 直前に表示したツイート ID（同じものを続けて出さない） */
  excludeId?: string;
  /**
   * いいね数のしきい値。集めてあるのは設定の下限以上なので、
   * それより低い値を渡しても下限に丸められる。
   */
  minLikes?: string | number | null;
  /** 抽選対象のスクリーンネーム。未指定（null）なら設定の全アカウント。 */
  screenNames?: string[] | null;
}

/**
 * 設定済みのスクリーンネームからランダムに 1 件バズツイートを選ぶ。
 *
 * 候補は全期間ぶんを集めたものなので、新着に偏らず一様に選ばれる。
 * ただし収集が終わるまでの数リクエストは、まだ集まっている範囲からの抽選になる。
 */
export async function getRandomBuzzTweet(
  options: RandomTweetOptions = {},
): Promise<RandomTweetResult> {
  const { excludeId } = options;
  const settings = await getSettings();
  const db = getDatabase(settings.cacheDir);
  const threshold = resolveMinLikes(options.minLikes, settings.minLikes);
  const criteria = {
    minLikes: threshold,
    requireImages: settings.requireImages,
  };

  const screenNames = selectScreenNames(settings, options.screenNames);
  if (screenNames.length === 0) {
    throw new NoTweetFoundError(
      options.screenNames
        ? "対象のアカウントが 1 件も選ばれていません。"
        : "スクリーンネームが 1 件も設定されていません。",
    );
  }

  // 認証エラーはアカウントを変えても直らないので、ここで先に弾く
  await getEmusksClient();

  const errors = new Set<string>();
  const entries = new Map<string, PoolEntry>();

  const loadPool = async (screenName: string): Promise<PoolEntry | null> => {
    try {
      const entry = await getPool(screenName, settings);
      entries.set(screenName, entry);
      return entry;
    } catch (error) {
      errors.add(`@${screenName}: ${(error as Error).message}`);
      return null;
    }
  };

  const draw = (screenName: string, size: number): RandomTweetResult | null => {
    const filter = buildFilter(settings, [screenName], threshold);
    const tweet = drawTweet(db, filter, excludeId);
    if (!tweet) return null;

    return {
      tweet,
      screenName,
      poolSize: size,
      poolComplete: entries.get(screenName)?.complete ?? false,
      criteria,
    };
  };

  if (settings.weightByPoolSize) {
    // 全アカウントぶんを用意し、候補数で重み付けして選ぶ
    // （＝全アカウントの全ツイートの中で一様）。
    // ここも同時に走る数は収集の上限に合わせて絞る。
    await mapWithConcurrency(
      screenNames,
      settings.maxConcurrentEnumerations,
      loadPool,
    );

    const counts = countTweetsByAccount(
      db,
      buildFilter(settings, screenNames, threshold),
    );
    const weights = screenNames
      .map((screenName) => ({
        screenName,
        size: counts.get(screenName.toLowerCase()) ?? 0,
      }))
      .filter(({ size }) => size > 0);

    if (weights.length > 0) {
      const screenName = pickWeighted(weights);
      const size = weights.find((w) => w.screenName === screenName)!.size;
      const result = draw(screenName, size);
      if (result) return result;
    }
  } else {
    // アカウントをシャッフルして、ヒットするまで順に試す（アカウントごとに等確率）
    for (const screenName of shuffle(screenNames)) {
      if (!(await loadPool(screenName))) continue;

      const size = countTweets(
        db,
        buildFilter(settings, [screenName], threshold),
      );
      if (size === 0) continue;

      const result = draw(screenName, size);
      if (result) return result;
    }
  }

  if (errors.size > 0) {
    throw new Error([...errors].join(" / "));
  }

  throw new NoTweetFoundError(
    `選択中の ${screenNames.length} アカウントに、条件（いいね ${threshold.toLocaleString(
      "ja-JP",
    )} 以上${
      settings.requireImages ? " / 画像付き" : ""
    }）に合うツイートが見つかりませんでした。`,
  );
}

/* ------------------------------------------------------------------ *
 * 保存済みのものを読むだけの API（新しく X は叩かない）
 * ------------------------------------------------------------------ */

/** X からプロフィールを 1 件取る。失敗しても一覧は出したいので null を返す。 */
async function fetchProfile(screenName: string): Promise<BuzzProfile | null> {
  try {
    const client = await getEmusksClient();
    const user = await client.users.getByUsername(screenName);
    if (!user) return null;

    return {
      screenName: user.username || screenName,
      name: user.name ?? "",
      avatarUrl: user.profile_picture?.url ?? "",
      verified: Boolean(
        user.verification?.verified || user.verification?.premium_verified,
      ),
    };
  } catch (error) {
    console.warn(`[buzz] @${screenName} のプロフィール取得に失敗:`, error);
    return null;
  }
}

/**
 * 設定済みのアカウント一覧を、絞り込みのプルダウンに出せる形で返す。
 *
 * 表示名とアイコンは保存済みのツイートかプロフィールのキャッシュから拾う。
 * どちらにも無いぶんは、{@link options.resolveProfiles} が立っているときだけ
 * X に問い合わせて埋める（失敗してもスクリーンネームだけで返す）。
 */
export async function listAccounts(options?: {
  resolveProfiles?: boolean;
}): Promise<BuzzAccount[]> {
  const settings = await getSettings();
  const db = getDatabase(settings.cacheDir);
  const screenNames = resolveScreenNames(settings);

  const counts = countTweetsByAccount(
    db,
    buildFilter(settings, screenNames, settings.minLikes),
  );

  const accounts = screenNames.map((screenName): BuzzAccount => {
    const key = screenName.toLowerCase();
    // アイコンは対象期間の外の投稿からでも構わない（新しいほど今の顔に近い）
    const profile = newestAuthor(db, key) ?? findProfile(db, key);

    return {
      screenName: profile?.screenName ?? screenName,
      name: profile?.name ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
      verified: profile?.verified ?? false,
      storedCount: counts.get(key) ?? 0,
      complete: pool.get(key)?.complete ?? readPoolState(db, key)?.complete ?? false,
      hasProfile: profile !== null,
    };
  });

  const missing = accounts.filter((account) => !account.hasProfile);
  if (!options?.resolveProfiles || missing.length === 0) return accounts;

  try {
    // 認証が通らないならアカウントを変えても同じなので、ここで先に確かめる
    await getEmusksClient();
  } catch (error) {
    console.warn("[buzz] プロフィールの補完をあきらめました:", error);
    return accounts;
  }

  const fetched = await mapWithConcurrency(missing, 3, async (account) => ({
    key: account.screenName.toLowerCase(),
    profile: await fetchProfile(account.screenName),
  }));

  const byKey = new Map(
    fetched
      .filter((result) => result.profile !== null)
      .map((result) => [result.key, result.profile!]),
  );
  saveProfiles(db, [...byKey.values()]);

  return accounts.map((account) => {
    const profile = byKey.get(account.screenName.toLowerCase());
    return profile ? { ...account, ...profile, hasProfile: true } : account;
  });
}

export function parseStoredSort(raw: string | null | undefined): StoredSort {
  return raw === "old" || raw === "likes" ? raw : "new";
}

export interface StoredTweetsQuery {
  /** 対象のスクリーンネーム。未指定（null）なら設定の全アカウント。 */
  screenNames?: string[] | null;
  minLikes?: string | number | null;
  sort?: StoredSort;
  offset?: number;
  limit?: number;
}

/**
 * 保存済みのツイートを、条件で絞って新しい順などに並べて返す。
 * 抽選と違ってここでは収集を走らせない（＝すでに集まっているものだけを見せる）。
 */
export async function listStoredTweets(
  query: StoredTweetsQuery = {},
): Promise<StoredTweetsResponse> {
  const settings = await getSettings();
  const db = getDatabase(settings.cacheDir);

  const threshold = resolveMinLikes(query.minLikes, settings.minLikes);
  const screenNames = selectScreenNames(settings, query.screenNames);
  const sort = query.sort ?? "new";
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(query.limit ?? STORED_PAGE_SIZE)),
  );

  const filter = buildFilter(settings, screenNames, threshold);

  return {
    tweets: listTweets(db, filter, sort, offset, limit),
    total: countTweets(db, filter),
    offset,
    limit,
  };
}
