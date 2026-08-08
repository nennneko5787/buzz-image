"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { AccountFilter, useAccountSelection } from "@/components/AccountFilter";
import { TweetCard } from "@/components/TweetCard";
import {
  type BuzzAccount,
  type BuzzTweet,
  STORED_PAGE_SIZE,
  type StoredSort,
  type StoredTweetsResponse,
} from "@/lib/types";

const SORT_OPTIONS: { value: StoredSort; label: string }[] = [
  { value: "new", label: "新しい順" },
  { value: "old", label: "古い順" },
  { value: "likes", label: "いいねが多い順" },
];

export function StoredTweets({
  accounts,
  minLikesFloor,
  initialData,
  initialError,
}: {
  accounts: BuzzAccount[];
  /** サーバー側で収集しているいいね数の下限。これより低くは絞り込めない。 */
  minLikesFloor: number;
  /** 初回分はサーバー側で読み込んだものを受け取る */
  initialData: StoredTweetsResponse | null;
  initialError: string | null;
}) {
  const [tweets, setTweets] = useState<BuzzTweet[]>(initialData?.tweets ?? []);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [minLikes, setMinLikes] = useState(minLikesFloor);
  const [minLikesInput, setMinLikesInput] = useState(String(minLikesFloor));
  const [sort, setSort] = useState<StoredSort>("new");

  /** 追い越された古い応答を捨てるための通し番号 */
  const requestId = useRef(0);

  const load = useCallback(
    async (params: {
      names: string[];
      threshold: number;
      sort: StoredSort;
      offset: number;
    }) => {
      const id = (requestId.current += 1);
      setLoading(true);
      setError(null);

      try {
        const search = new URLSearchParams({
          users: params.names.join(","),
          minLikes: String(params.threshold),
          sort: params.sort,
          offset: String(params.offset),
          limit: String(STORED_PAGE_SIZE),
        });
        const res = await fetch(`/api/stored?${search}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (id !== requestId.current) return;

        const data = json as StoredTweetsResponse;
        setTweets((current) =>
          params.offset === 0 ? data.tweets : [...current, ...data.tweets],
        );
        setTotal(data.total);
      } catch (e) {
        if (id === requestId.current) setError((e as Error).message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  // 初回分は全アカウントぶんなので、前回の絞り込みが復元されたら読み直す
  const { selected, setSelected } = useAccountSelection(accounts, (names) => {
    void load({ names, threshold: minLikes, sort, offset: 0 });
  });

  const changeAccounts = useCallback(
    (names: string[]) => {
      setSelected(names);
      void load({ names, threshold: minLikes, sort, offset: 0 });
    },
    [load, minLikes, setSelected, sort],
  );

  const changeSort = useCallback(
    (next: StoredSort) => {
      setSort(next);
      void load({ names: selected, threshold: minLikes, sort: next, offset: 0 });
    },
    [load, minLikes, selected],
  );

  /** 入力欄の値を確定し、変わっていれば読み直す */
  const commitMinLikes = useCallback(() => {
    const parsed = Number(minLikesInput);
    const next =
      Number.isFinite(parsed) && parsed > 0
        ? Math.max(minLikesFloor, Math.floor(parsed))
        : minLikesFloor;
    setMinLikesInput(String(next));
    if (next === minLikes) return;
    setMinLikes(next);
    void load({ names: selected, threshold: next, sort, offset: 0 });
  }, [load, minLikes, minLikesFloor, minLikesInput, selected, sort]);

  const hasMore = tweets.length < total;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ストア済みツイート</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            これまでに収集してキャッシュしてあるツイートの一覧です。ここでは新しく X
            に取りにいきません。
          </p>
        </div>
        <Link href="/" className="text-sm underline-offset-4 hover:underline">
          ガチャに戻る
        </Link>
      </header>

      <section className="grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-3 dark:border-white/15">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">対象アカウント</span>
          <AccountFilter
            accounts={accounts}
            selected={selected}
            onChange={changeAccounts}
            disabled={loading}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="stored-min-likes" className="text-sm font-medium">
            いいね数のしきい値
          </label>
          <input
            id="stored-min-likes"
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
            className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-1.5 text-right tabular-nums disabled:opacity-50 dark:border-white/20"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="stored-sort" className="text-sm font-medium">
            並び順
          </label>
          <select
            id="stored-sort"
            value={sort}
            disabled={loading}
            onChange={(event) => changeSort(event.target.value as StoredSort)}
            className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
          >
            {SORT_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="dark:bg-zinc-900"
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <p className="text-sm text-black/55 dark:text-white/55">
        条件に合うツイート {total.toLocaleString("ja-JP")} 件
        {total > 0 && `（${tweets.length.toLocaleString("ja-JP")} 件表示中）`}
      </p>

      {error && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <p className="font-bold">読み込めませんでした</p>
          <p className="mt-1 break-words">{error}</p>
        </div>
      )}

      {tweets.length === 0 && !loading && !error && (
        <p className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
          {selected.length === 0
            ? "対象のアカウントが 1 件も選ばれていません。"
            : "条件に合うツイートがまだストアされていません。ガチャを回すと収集が始まります。"}
        </p>
      )}

      <ul
        className={`flex flex-col gap-5 transition-opacity ${
          loading ? "opacity-40" : "opacity-100"
        }`}
      >
        {tweets.map((tweet) => (
          <li key={tweet.id}>
            <TweetCard tweet={tweet} />
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          disabled={loading}
          onClick={() =>
            void load({
              names: selected,
              threshold: minLikes,
              sort,
              offset: tweets.length,
            })
          }
          className="mx-auto rounded-full border border-black/20 px-8 py-2.5 text-sm font-bold transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/25 dark:hover:bg-white/[0.06]"
        >
          {loading ? "読み込み中…" : "もっと見る"}
        </button>
      )}
    </div>
  );
}
