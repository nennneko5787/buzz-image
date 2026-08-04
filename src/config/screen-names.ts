/**
 * アプリの設定。
 *
 * 表示対象のスクリーンネーム（@ なし）はここで「あらかじめ」設定する。
 * 環境変数 `SCREEN_NAMES`（カンマ区切り）が設定されていればそちらが優先される。
 */

/** 既定のスクリーンネーム一覧。自由に書き換えて使う。 */
export const DEFAULT_SCREEN_NAMES = [
  "nennneko5787",
  "elonmusk",
  "NintendoAmerica",
  "NASA",
  "nasjp",
  "Nyaromenta",
  "hyoshiok",
] as const;

/**
 * いいね数のしきい値の下限（この値「以上」のツイートだけを収集する）。
 *
 * サーバー側の検索クエリ・候補プールはこの値で作られるので、
 * ユーザーはこれ「以上」の範囲でしか絞り込めない（下限未満は候補が存在しない）。
 */
export const MIN_LIKES = Number(process.env.MIN_LIKES ?? 10000);

/**
 * ユーザーが指定したしきい値を、実際に使える値に正規化する。
 * 未指定・不正値・下限未満はすべて {@link MIN_LIKES} に丸める。
 */
export function resolveMinLikes(
  raw: string | number | null | undefined,
): number {
  if (raw === null || raw === undefined || raw === "") return MIN_LIKES;
  const value = Number(raw);
  if (!Number.isFinite(value)) return MIN_LIKES;
  return Math.max(MIN_LIKES, Math.floor(value));
}

/** 画像が添付されたツイートだけを対象にするか */
export const REQUIRE_IMAGES =
  (process.env.REQUIRE_IMAGES ?? "true").toLowerCase() !== "false";

/**
 * 何ヶ月前より古い投稿を対象にするか（検索演算子 `until:` に対応）。
 * 例: 3 なら「3 ヶ月前より前」の投稿だけが対象になる。未設定なら期間の制限なし。
 * 小数も使える（例: 0.5 = 約 15 日）。
 */
export const UNTIL_MONTHS_AGO = (() => {
  const raw = process.env.UNTIL_MONTHS_AGO;
  if (!raw) return null;
  const months = Number(raw);
  if (!Number.isFinite(months) || months <= 0) return null;
  return months;
})();

/** 対象期間の終端（この日より前の投稿だけを対象にする）。制限なしなら null。 */
export function getUntilDate(): Date | null {
  if (UNTIL_MONTHS_AGO === null) return null;
  const until = new Date();
  until.setMonth(until.getMonth() - Math.floor(UNTIL_MONTHS_AGO));
  // 小数ぶんは日数に換算して引く（1 ヶ月 = 30 日とみなす）
  const fraction = UNTIL_MONTHS_AGO - Math.floor(UNTIL_MONTHS_AGO);
  if (fraction > 0) until.setDate(until.getDate() - Math.round(fraction * 30));
  until.setHours(0, 0, 0, 0);
  return until;
}

/** X の検索演算子 `until:` に渡す YYYY-MM-DD 形式 */
export function formatSearchDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 全期間を辿るときのページ数の安全上限（1 ページ 40 件）。
 * 通常はカーソルが尽きて先に終わる。暴走防止のためのフェイルセーフ。
 */
export const MAX_PAGES = Number(process.env.MAX_PAGES ?? 40);

/** 全期間の列挙中、ページ取得の間に空ける時間（ミリ秒）。レート制限対策。 */
export const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? 400);

/**
 * 初回表示のために同期で辿るページ数の上限。
 * 期間指定などで先頭ページに 1 件も該当がないことがあるため、
 * 最低 1 件見つかるまではここまで同期で辿る。
 */
export const MAX_SYNC_PAGES = Number(process.env.MAX_SYNC_PAGES ?? 10);

/** 候補プールのキャッシュ有効期間（ミリ秒）。既定 24 時間。 */
export const CACHE_TTL_MS = Number(
  process.env.CACHE_TTL_MS ?? 24 * 60 * 60 * 1000,
);

/** 候補プールをディスクに保存するディレクトリ（プロセス再起動をまたいで再利用する） */
export const CACHE_DIR = process.env.CACHE_DIR ?? ".cache/buzz-pools";

/**
 * アカウントを候補数で重み付けして選ぶか。
 * false（既定）だとアカウントごとに等確率、true だと全アカウントの全ツイートで等確率になる。
 */
export const WEIGHT_BY_POOL_SIZE =
  (process.env.WEIGHT_BY_POOL_SIZE ?? "false").toLowerCase() === "true";

function parseScreenNames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((name) => name.trim().replace(/^@/, ""))
    .filter(Boolean);
}

/** 実際に使うスクリーンネーム一覧 */
export function getScreenNames(): string[] {
  const fromEnv = parseScreenNames(process.env.SCREEN_NAMES);
  const names = fromEnv.length > 0 ? fromEnv : [...DEFAULT_SCREEN_NAMES];
  // 重複除去（大文字小文字は区別しない）
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
