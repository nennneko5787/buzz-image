"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/settings/actions";
import type { PanelActionState } from "@/lib/settings-schema";

const INITIAL_STATE: PanelActionState = { status: "idle", message: "" };

export function PanelLogin() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded-2xl border border-black/10 p-6 dark:border-white/15"
    >
      <h1 className="text-lg font-bold">設定パネル</h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        続けるにはパスワードを入力してください。
      </p>

      <input
        type="password"
        name="password"
        autoComplete="current-password"
        autoFocus
        disabled={pending}
        className="mt-4 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 disabled:opacity-50 dark:border-white/20"
      />

      {state.status === "error" && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-full bg-black px-6 py-2.5 font-bold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "確認中…" : "ログイン"}
      </button>
    </form>
  );
}
