import { BuzzViewer } from "@/components/BuzzViewer";
import { getRandomBuzzTweet } from "@/lib/buzz";
import { getSettings, resolveScreenNames } from "@/lib/settings";
import type { RandomTweetResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = await getSettings();

  let initialData: RandomTweetResponse | null = null;
  let initialError: string | null = null;

  try {
    initialData = await getRandomBuzzTweet();
  } catch (error) {
    initialError = (error as Error).message;
  }

  return (
    <main className="flex flex-1 items-start justify-center bg-zinc-50 px-4 py-10 font-sans sm:py-16 dark:bg-black">
      <BuzzViewer
        screenNames={resolveScreenNames(settings)}
        minLikesFloor={settings.minLikes}
        untilMonthsAgo={settings.untilMonthsAgo}
        initialData={initialData}
        initialError={initialError}
      />
    </main>
  );
}
