import { NextResponse } from "next/server";

import { listStoredTweets, parseStoredSort } from "@/lib/buzz";
import {
  parseIntParam,
  parseRequestedScreenNames,
} from "@/lib/request-params";
import { STORED_PAGE_SIZE } from "@/lib/types";

// 読むのはディスクとメモリのキャッシュだけだが、fs を使うので Node.js ランタイム。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  try {
    return NextResponse.json(
      await listStoredTweets({
        screenNames: parseRequestedScreenNames(params),
        minLikes: params.get("minLikes"),
        sort: parseStoredSort(params.get("sort")),
        offset: parseIntParam(params, "offset", 0),
        limit: parseIntParam(params, "limit", STORED_PAGE_SIZE),
      }),
    );
  } catch (error) {
    console.error("[api/stored]", error);
    return NextResponse.json(
      {
        error: `ストア済みツイートの取得に失敗しました: ${(error as Error).message}`,
      },
      { status: 500 },
    );
  }
}
