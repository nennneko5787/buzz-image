import { NextResponse } from "next/server";

import { NoTweetFoundError, getRandomBuzzTweet } from "@/lib/buzz";
import { MissingAuthTokenError } from "@/lib/emusks-client";

// cycletls（Go バイナリ）を使うので Node.js ランタイム必須。キャッシュもしない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const exclude = params.get("exclude") ?? undefined;
  // ユーザー指定のしきい値。設定の下限を下回る値は丸められる。
  const minLikes = params.get("minLikes");

  try {
    return NextResponse.json(await getRandomBuzzTweet(exclude, minLikes));
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
