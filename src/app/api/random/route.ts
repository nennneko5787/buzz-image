import { NextResponse } from "next/server";

import { MIN_LIKES, REQUIRE_IMAGES } from "@/config/screen-names";
import { NoTweetFoundError, getRandomBuzzTweet } from "@/lib/buzz";
import { MissingAuthTokenError } from "@/lib/emusks-client";

// cycletls（Go バイナリ）を使うので Node.js ランタイム必須。キャッシュもしない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const exclude =
    new URL(request.url).searchParams.get("exclude") ?? undefined;

  try {
    const result = await getRandomBuzzTweet(exclude);
    return NextResponse.json({
      ...result,
      criteria: { minLikes: MIN_LIKES, requireImages: REQUIRE_IMAGES },
    });
  } catch (error) {
    if (error instanceof MissingAuthTokenError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof NoTweetFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[api/random]", error);
    return NextResponse.json(
      { error: `ツイートの取得に失敗しました: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
