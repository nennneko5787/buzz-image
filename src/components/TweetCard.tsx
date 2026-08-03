import Image from "next/image";

import type { BuzzMedia, BuzzTweet } from "@/lib/types";

const numberFormat = new Intl.NumberFormat("ja-JP");
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function MediaGrid({ media }: { media: BuzzMedia[] }) {
  if (media.length === 0) return null;

  const single = media.length === 1;

  return (
    <div
      className={`mt-4 grid gap-1 overflow-hidden rounded-2xl border border-black/10 dark:border-white/15 ${
        single ? "grid-cols-1" : "grid-cols-2"
      }`}
    >
      {media.map((item, index) => (
        <div
          key={`${item.url}-${index}`}
          className={`relative bg-black/5 dark:bg-white/5 ${
            single ? "aspect-auto" : "aspect-square"
          } ${media.length === 3 && index === 0 ? "row-span-2" : ""}`}
        >
          {single ? (
            <Image
              src={item.url}
              alt={item.alt ?? "添付画像"}
              width={item.width}
              height={item.height}
              sizes="(max-width: 640px) 100vw, 600px"
              className="h-auto w-full object-contain"
              unoptimized
            />
          ) : (
            <Image
              src={item.url}
              alt={item.alt ?? "添付画像"}
              fill
              sizes="(max-width: 640px) 50vw, 300px"
              className="object-cover"
              unoptimized
            />
          )}

          {item.kind !== "photo" && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              {item.kind === "gif"
                ? "GIF"
                : `動画${item.durationSec ? ` ${item.durationSec}秒` : ""}`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
      <span className={`text-lg font-bold tabular-nums ${accent}`}>
        {numberFormat.format(value)}
      </span>
      <span className="text-[11px] text-black/55 dark:text-white/55">
        {label}
      </span>
    </div>
  );
}

export function TweetCard({ tweet }: { tweet: BuzzTweet }) {
  return (
    <article className="w-full rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-6 dark:border-white/15 dark:bg-white/[0.03]">
      <header className="flex items-center gap-3">
        {tweet.author.avatarUrl && (
          <Image
            src={tweet.author.avatarUrl.replace("_normal", "_bigger")}
            alt=""
            width={48}
            height={48}
            className="rounded-full"
            unoptimized
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate font-bold">{tweet.author.name}</span>
            {tweet.author.verified && (
              <span
                aria-label="認証済み"
                title="認証済み"
                className="text-sky-500"
              >
                ✓
              </span>
            )}
          </div>
          <a
            href={`https://x.com/${tweet.author.username}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-black/55 hover:underline dark:text-white/55"
          >
            @{tweet.author.username}
          </a>
        </div>
      </header>

      {tweet.text && (
        <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed sm:text-base">
          {tweet.text}
        </p>
      )}

      <MediaGrid media={tweet.media} />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat
          label="いいね"
          value={tweet.stats.likes}
          accent="text-pink-600 dark:text-pink-400"
        />
        <Stat
          label="リツイート"
          value={tweet.stats.retweets}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <Stat
          label="リプライ"
          value={tweet.stats.replies}
          accent="text-sky-600 dark:text-sky-400"
        />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-black/50 dark:text-white/50">
        <time dateTime={tweet.createdAt}>
          {dateFormat.format(new Date(tweet.createdAt))}
        </time>
        <a
          href={tweet.url}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-sky-600 hover:underline dark:text-sky-400"
        >
          X で開く →
        </a>
      </footer>
    </article>
  );
}
