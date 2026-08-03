"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TweetCard } from "@/components/TweetCard";
import type { RandomTweetResponse } from "@/lib/types";

export function BuzzViewer({
  screenNames,
  minLikes,
  untilMonthsAgo,
  initialData,
  initialError,
}: {
  screenNames: string[];
  minLikes: number;
  /** 何ヶ月前より古い投稿を対象にしているか。null なら期間の制限なし。 */
  untilMonthsAgo: number | null;
  /** 初回分はサーバー側で取得済みのものを受け取る */
  initialData: RandomTweetResponse | null;
  initialError: string | null;
}) {
  const [data, setData] = useState<RandomTweetResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const currentId = useRef<string | undefined>(initialData?.tweet.id);

  const periodLabel =
    untilMonthsAgo === null ? "全期間" : `${untilMonthsAgo} ヶ月前より古い投稿`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentId.current) params.set("exclude", currentId.current);
      const res = await fetch(`/api/random?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      currentId.current = json.tweet.id;
      setData(json as RandomTweetResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // スペースキーでも次のツイートを引ける
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code !== "Space") return;
      event.preventDefault();
      if (!loading) void load();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load, loading]);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6">
      <header className="w-full text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">バズツイートガチャ</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          登録済みの {screenNames.length} アカウントの{periodLabel}から、いいね{" "}
          {minLikes.toLocaleString("ja-JP")} 以上のツイートをランダム表示します。
        </p>
      </header>

      <div className="flex w-full min-h-[420px] flex-col items-center justify-center gap-4">
        {error && (
          <div className="w-full rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            <p className="font-bold">取得できませんでした</p>
            <p className="mt-1 break-words">{error}</p>
          </div>
        )}

        {data ? (
          <div
            className={`w-full transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}
          >
            <TweetCard tweet={data.tweet} />
            <p className="mt-3 text-center text-xs text-black/45 dark:text-white/45">
              {data.poolComplete
                ? `@${data.screenName} の${periodLabel} ${data.poolSize} 件から抽選`
                : `@${data.screenName} の候補を収集中… 現在の ${data.poolSize} 件から抽選`}
            </p>
          </div>
        ) : (
          loading && (
            <p className="animate-pulse text-sm text-black/50 dark:text-white/50">
              読み込み中…
            </p>
          )
        )}
      </div>

      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="rounded-full bg-black px-8 py-3 font-bold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {loading ? "抽選中…" : "次のツイート（Space）"}
      </button>

      <details className="w-full rounded-2xl border border-black/10 p-4 text-sm dark:border-white/15">
        <summary className="cursor-pointer font-medium">
          登録アカウント一覧（{screenNames.length}）
        </summary>
        <ul className="mt-3 flex flex-wrap gap-2">
          {screenNames.map((name) => (
            <li key={name}>
              <a
                href={`https://x.com/${name}`}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full bg-black/[0.05] px-3 py-1 text-xs hover:underline dark:bg-white/[0.08]"
              >
                @{name}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
