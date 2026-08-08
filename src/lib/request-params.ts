import { parseScreenNames } from "@/lib/settings-schema";

/**
 * クエリ文字列の `users`（カンマ区切り）を対象スクリーンネームとして読む。
 *
 * - パラメータ自体が無い → null（＝絞り込みなし。設定の全アカウントが対象）
 * - `users=`（空） → 空配列（＝1 件も選ばれていない）
 */
export function parseRequestedScreenNames(
  params: URLSearchParams,
): string[] | null {
  if (!params.has("users")) return null;
  return parseScreenNames(params.get("users") ?? "");
}

/** クエリ文字列の数値。空・不正なら fallback。 */
export function parseIntParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}
