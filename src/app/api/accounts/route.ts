import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/buzz";
import type { AccountsResponse } from "@/lib/types";

// cycletls（Go バイナリ）を使うので Node.js ランタイム必須。キャッシュもしない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // profiles=1 のときだけ、キャッシュに無いプロフィールを X に取りにいく
  const resolveProfiles = params.get("profiles") === "1";

  try {
    const accounts = await listAccounts({ resolveProfiles });
    return NextResponse.json({ accounts } satisfies AccountsResponse);
  } catch (error) {
    console.error("[api/accounts]", error);
    return NextResponse.json(
      {
        error: `アカウント一覧の取得に失敗しました: ${(error as Error).message}`,
      },
      { status: 500 },
    );
  }
}
