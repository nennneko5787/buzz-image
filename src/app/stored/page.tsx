import type { Metadata } from "next";

import { StoredTweets } from "@/components/StoredTweets";
import { listAccounts, listStoredTweets } from "@/lib/buzz";
import { getSettings } from "@/lib/settings";
import { STORED_PAGE_SIZE, type StoredTweetsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ストア済みツイート | バズツイートガチャ",
};

export default async function StoredPage() {
  const settings = await getSettings();
  const accounts = await listAccounts();

  let initialData: StoredTweetsResponse | null = null;
  let initialError: string | null = null;

  try {
    initialData = await listStoredTweets({ limit: STORED_PAGE_SIZE });
  } catch (error) {
    initialError = (error as Error).message;
  }

  return (
    <main className="flex flex-1 items-start justify-center bg-zinc-50 px-4 py-10 font-sans sm:py-16 dark:bg-black">
      <StoredTweets
        accounts={accounts}
        minLikesFloor={settings.minLikes}
        initialData={initialData}
        initialError={initialError}
      />
    </main>
  );
}
