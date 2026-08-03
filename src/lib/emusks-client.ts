import "server-only";

import type Emusks from "emusks";

/**
 * emusks クライアントのシングルトン。
 *
 * emusks は import した時点で cycletls（Go 製バイナリ）のプロセスを起動するため、
 * モジュールのトップレベルではなく最初のリクエスト時に動的 import する。
 * dev のホットリロードでプロセスが増えないよう globalThis に保持する。
 */

const globalForEmusks = globalThis as unknown as {
  __emusksClient?: Promise<Emusks>;
};

export class MissingAuthTokenError extends Error {
  constructor() {
    super(
      "X_AUTH_TOKEN が設定されていません。.env.local に X_AUTH_TOKEN=... を設定してください。",
    );
    this.name = "MissingAuthTokenError";
  }
}

async function createClient(): Promise<Emusks> {
  const authToken = process.env.X_AUTH_TOKEN?.trim();
  if (!authToken) throw new MissingAuthTokenError();

  const { default: Emusks } = await import("emusks");
  const client = new Emusks();

  await client.login({
    auth_token: authToken,
    client: process.env.X_CLIENT ?? "web",
    ...(process.env.X_PROXY ? { proxy: process.env.X_PROXY } : {}),
  });

  return client;
}

export function getEmusksClient(): Promise<Emusks> {
  if (!globalForEmusks.__emusksClient) {
    globalForEmusks.__emusksClient = createClient().catch((error) => {
      // ログインに失敗したら次のリクエストでやり直せるようにキャッシュを捨てる
      globalForEmusks.__emusksClient = undefined;
      throw error;
    });
  }
  return globalForEmusks.__emusksClient;
}
