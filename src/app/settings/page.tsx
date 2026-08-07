import type { Metadata } from "next";

import { PanelLogin } from "@/components/PanelLogin";
import { SettingsPanel } from "@/components/SettingsPanel";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import {
  getPasswordSource,
  getSettingsForPanel,
  isPanelConfigured,
} from "@/lib/settings";
import { SECRET_KEYS, type SettingKey, toFormValues } from "@/lib/settings-schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "設定パネル | バズツイートガチャ",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-start justify-center bg-zinc-50 px-4 py-10 font-sans sm:py-16 dark:bg-black">
      {children}
    </main>
  );
}

export default async function SettingsPage() {
  if (!(await isPanelConfigured())) {
    return (
      <Shell>
        <div className="w-full max-w-sm rounded-2xl border border-black/10 p-6 text-sm dark:border-white/15">
          <h1 className="text-lg font-bold">設定パネルは無効です</h1>
          <p className="mt-2 text-black/60 dark:text-white/60">
            パスワードが未設定のため、パネルを開けないようにしています。
            <code className="mx-1 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-xs dark:bg-white/[0.08]">
              .env
            </code>
            に
            <code className="mx-1 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-xs dark:bg-white/[0.08]">
              PANEL_PASSWORD=...
            </code>
            を設定して起動し直してください。
          </p>
        </div>
      </Shell>
    );
  }

  if (!(await isPanelAuthenticated())) {
    return (
      <Shell>
        <PanelLogin />
      </Shell>
    );
  }

  const { settings, env, overridden, updatedAt } = await getSettingsForPanel();
  const passwordSource = await getPasswordSource();

  // 秘匿値そのものはクライアントに渡さず、設定済みかどうかだけ伝える
  const secretPresent: Partial<Record<SettingKey, boolean>> = {};
  for (const key of SECRET_KEYS) {
    const value = settings[key];
    secretPresent[key] = typeof value === "string" && value.length > 0;
  }

  return (
    <Shell>
      <SettingsPanel
        values={toFormValues(settings)}
        envValues={toFormValues(env)}
        overridden={overridden}
        secretPresent={secretPresent}
        updatedAt={updatedAt}
        passwordSource={passwordSource === "panel" ? "panel" : "env"}
      />
    </Shell>
  );
}
