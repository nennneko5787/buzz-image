import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import type { BuzzTweet } from "@/lib/types";

/**
 * 候補プールのディスクキャッシュ。
 *
 * 全期間の列挙は数十リクエストかかるので、プロセスを再起動しても
 * やり直さずに済むよう JSON で保存しておく。
 * 失敗しても致命的ではないため、入出力エラーはすべて握りつぶす。
 */

export interface StoredPool {
  /** 収集に使った検索クエリ。条件を変えたらキャッシュを無効にするために持つ */
  query: string;
  tweets: BuzzTweet[];
  /** 全期間を辿り終えているか */
  complete: boolean;
  /** 続きから再開するためのカーソル */
  cursor: string | null;
  fetchedAt: number;
}

function cacheFile(screenName: string, cacheDir: string): string {
  const safe = screenName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const dir = path.isAbsolute(cacheDir)
    ? cacheDir
    : // 実行時にしか決まらないパス。バンドラに追跡させない。
      path.join(/* turbopackIgnore: true */ process.cwd(), cacheDir);
  return path.join(dir, `${safe}.json`);
}

export async function readStoredPool(
  screenName: string,
  cacheDir: string,
): Promise<StoredPool | null> {
  try {
    const raw = await fs.readFile(cacheFile(screenName, cacheDir), "utf8");
    const parsed = JSON.parse(raw) as StoredPool;
    if (!Array.isArray(parsed.tweets) || typeof parsed.query !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeStoredPool(
  screenName: string,
  cacheDir: string,
  pool: StoredPool,
): Promise<void> {
  try {
    const file = cacheFile(screenName, cacheDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(pool), "utf8");
  } catch {
    // キャッシュの書き込み失敗は無視する（次回また集め直すだけ）
  }
}
