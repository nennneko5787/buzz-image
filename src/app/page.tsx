import { BuzzViewer } from "@/components/BuzzViewer";
import {
  MIN_LIKES,
  REQUIRE_IMAGES,
  UNTIL_MONTHS_AGO,
  getScreenNames,
} from "@/config/screen-names";
import { getRandomBuzzTweet } from "@/lib/buzz";
import type { RandomTweetResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialData: RandomTweetResponse | null = null;
  let initialError: string | null = null;

  try {
    const result = await getRandomBuzzTweet();
    initialData = {
      ...result,
      criteria: { minLikes: MIN_LIKES, requireImages: REQUIRE_IMAGES },
    };
  } catch (error) {
    initialError = (error as Error).message;
  }

  return (
    <main className="flex flex-1 items-start justify-center bg-zinc-50 px-4 py-10 font-sans sm:py-16 dark:bg-black">
      <BuzzViewer
        screenNames={getScreenNames()}
        minLikes={MIN_LIKES}
        untilMonthsAgo={UNTIL_MONTHS_AGO}
        initialData={initialData}
        initialError={initialError}
      />
    </main>
  );
}
