"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { TweetCard } from "@/components/TweetCard";
import type { RandomTweetResponse } from "@/lib/types";

export function BuzzViewer({
  screenNames,
  minLikesFloor,
  untilMonthsAgo,
  initialData,
  initialError,
}: {
  screenNames: string[];
  /**
   * サーバー側（.env の MIN_LIKES）で収集しているいいね数の下限。
   * 候補プール自体がこの値で作られているので、これより低くは絞り込めない。
   */
  minLikesFloor: number;
  /** 何ヶ月前より古い投稿を対象にしているか。null なら期間の制限なし。 */
  untilMonthsAgo: number | null;
  /** 初回分はサーバー側で取得済みのものを受け取る */
  initialData: RandomTweetResponse | null;
  initialError: string | null;
}) {
  const [data, setData] = useState<RandomTweetResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  /** 実際に使っているしきい値 */
  const [minLikes, setMinLikes] = useState(minLikesFloor);
  /** 入力欄の中身。確定（Enter / フォーカスを外す）したときだけ minLikes に反映する */
  const [minLikesInput, setMinLikesInput] = useState(String(minLikesFloor));
  const currentId = useRef<string | undefined>(initialData?.tweet.id);

  const periodLabel =
    untilMonthsAgo === null ? "全期間" : `${untilMonthsAgo} ヶ月前より古い投稿`;

  const load = useCallback(async (threshold: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentId.current) params.set("exclude", currentId.current);
      params.set("minLikes", String(threshold));
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

  /** 入力欄の値を確定し、変わっていれば新しい条件で引き直す */
  const commitMinLikes = useCallback(() => {
    const parsed = Number(minLikesInput);
    const next =
      Number.isFinite(parsed) && parsed > 0
        ? Math.max(minLikesFloor, Math.floor(parsed))
        : minLikesFloor;
    setMinLikesInput(String(next));
    if (next === minLikes) return;
    setMinLikes(next);
    void load(next);
  }, [load, minLikes, minLikesFloor, minLikesInput]);

  // スペースキーでも次のツイートを引ける
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code !== "Space") return;
      event.preventDefault();
      if (!loading) void load(minLikes);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load, loading, minLikes]);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6">
      <header className="w-full text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">バズツイートガチャ</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          登録済みの {screenNames.length} アカウントの{periodLabel}から、いいね{" "}
          {minLikes.toLocaleString("ja-JP")} 以上のツイートをランダム表示します。
        </p>
      </header>

      <div className="flex w-full flex-col items-center gap-1">
        <label className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="font-medium">いいね数のしきい値</span>
          <input
            type="number"
            inputMode="numeric"
            min={minLikesFloor}
            step={1000}
            value={minLikesInput}
            disabled={loading}
            onChange={(event) => setMinLikesInput(event.target.value)}
            onBlur={commitMinLikes}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitMinLikes();
              }
            }}
            className="w-32 rounded-lg border border-black/15 bg-transparent px-3 py-1.5 text-right tabular-nums disabled:opacity-50 dark:border-white/20"
          />
          <span className="text-black/60 dark:text-white/60">以上</span>
        </label>
        <p className="text-xs text-black/45 dark:text-white/45">
          サーバー側で集めている下限は {minLikesFloor.toLocaleString("ja-JP")}{" "}
          です。これより低い値は下限に丸められます。
        </p>
      </div>

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
        onClick={() => void load(minLikes)}
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

      <Link
        href="/settings"
        className="text-xs text-black/45 underline-offset-4 hover:underline dark:text-white/45"
      >
        設定パネル
      </Link>
    </div>
  );
}
