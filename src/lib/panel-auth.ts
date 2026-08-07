import "server-only";

import crypto from "node:crypto";

import { cookies } from "next/headers";

import {
  getPasswordFingerprint,
  getSessionSecret,
  isPanelConfigured,
  verifyPanelPassword,
} from "@/lib/settings";

/**
 * 設定パネルのパスワード認証。
 *
 * 利用者が 1 人のローカル運用を想定しているので、セッションは
 * サーバー側に持たず「有効期限 + HMAC 署名」を Cookie に入れるだけにする。
 * 署名にはパスワードの指紋を混ぜてあり、パスワードを変えると
 * 発行済みのセッションはすべて無効になる。
 */

const COOKIE_NAME = "buzz_panel_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 総当たり対策。ここまで失敗したらしばらく受け付けない。 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

const globalForAuth = globalThis as unknown as {
  __buzzPanelAttempts?: { failures: number; lockedUntil: number };
};

const attempts = (globalForAuth.__buzzPanelAttempts ??= {
  failures: 0,
  lockedUntil: 0,
});

async function sign(expiresAt: number): Promise<string> {
  const [secret, fingerprint] = await Promise.all([
    getSessionSecret(),
    getPasswordFingerprint(),
  ]);
  return crypto
    .createHmac("sha256", secret)
    .update(`${expiresAt}.${fingerprint}`)
    .digest("hex");
}

/** ログイン済みか（Cookie の署名と有効期限を検証する） */
export async function isPanelAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return false;

  const [rawExpiresAt, signature] = token.split(".");
  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (Date.now() >= expiresAt) return false;

  const expected = await sign(expiresAt);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signature, "utf8"),
  );
}

export type LoginResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * パスワードを検証し、通ればセッション Cookie を発行する。
 * Server Action / Route Handler からのみ呼べる（Cookie を書くため）。
 */
export async function login(password: string): Promise<LoginResult> {
  if (!(await isPanelConfigured())) {
    return {
      ok: false,
      message:
        "パネルのパスワードが未設定です。.env に PANEL_PASSWORD=... を設定してください。",
    };
  }

  const now = Date.now();
  if (attempts.lockedUntil > now) {
    const seconds = Math.ceil((attempts.lockedUntil - now) / 1000);
    return {
      ok: false,
      message: `試行回数が多すぎます。${seconds} 秒後にもう一度お試しください。`,
    };
  }

  if (!password) {
    return { ok: false, message: "パスワードを入力してください。" };
  }

  if (!(await verifyPanelPassword(password))) {
    attempts.failures += 1;
    if (attempts.failures >= MAX_ATTEMPTS) {
      attempts.failures = 0;
      attempts.lockedUntil = now + LOCKOUT_MS;
    }
    return { ok: false, message: "パスワードが違います。" };
  }

  attempts.failures = 0;
  attempts.lockedUntil = 0;

  const expiresAt = now + SESSION_TTL_MS;
  (await cookies()).set(COOKIE_NAME, `${expiresAt}.${await sign(expiresAt)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });

  return { ok: true };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** Server Action の入口で使う。未ログインなら例外を投げる。 */
export async function requirePanelSession(): Promise<void> {
  if (!(await isPanelAuthenticated())) {
    throw new Error("ログインしていません。ページを再読み込みしてください。");
  }
}
