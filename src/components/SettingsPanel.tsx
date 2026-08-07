"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import {
  changePasswordAction,
  logoutAction,
  resetSettingsAction,
  saveSettingsAction,
} from "@/app/settings/actions";
import {
  type PanelActionState,
  SECRET_KEYS,
  SETTING_FIELDS,
  SETTING_GROUPS,
  type SettingField,
  type SettingKey,
  type SettingsFormValues,
} from "@/lib/settings-schema";

const INITIAL_STATE: PanelActionState = { status: "idle", message: "" };

const GROUPED = SETTING_GROUPS.map((group) => ({
  group,
  fields: SETTING_FIELDS.filter((field) => field.group === group),
})).filter(({ fields }) => fields.length > 0);

const inputClass =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-white/20";

export function SettingsPanel({
  values: savedValues,
  envValues,
  overridden,
  secretPresent,
  updatedAt,
  passwordSource,
}: {
  /** 現在の設定（秘匿値は空文字） */
  values: SettingsFormValues;
  /** .env 由来の値（秘匿値は空文字） */
  envValues: SettingsFormValues;
  /** .env から変更されている項目 */
  overridden: SettingKey[];
  /** 秘匿値が設定済みかどうか */
  secretPresent: Partial<Record<SettingKey, boolean>>;
  updatedAt: number | null;
  passwordSource: "panel" | "env";
}) {
  const [values, setValues] = useState(savedValues);
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const [confirmingReset, setConfirmingReset] = useState(false);

  // 保存や初期化のあとにサーバーから新しい値が届いたら、入力欄をそれに合わせ直す
  const [seededFrom, setSeededFrom] = useState(savedValues);
  if (seededFrom !== savedValues) {
    setSeededFrom(savedValues);
    setValues(savedValues);
  }

  const overriddenSet = new Set(overridden);

  const set = (key: SettingKey, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const run = (action: () => Promise<PanelActionState>) => {
    startTransition(async () => {
      try {
        const result = await action();
        setState(result);
        if (result.status === "ok") {
          // 入力した auth_token などを画面に残したままにしない
          setValues((current) => {
            const next = { ...current };
            for (const key of SECRET_KEYS) next[key] = "";
            return next;
          });
        }
      } catch (error) {
        setState({ status: "error", message: (error as Error).message });
      }
    });
  };

  return (
    <div className="w-full max-w-2xl">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">設定パネル</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            .env の内容をここから変更できます。変更は保存され、次回の起動にも引き継がれます。
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="underline-offset-4 hover:underline"
          >
            ガチャに戻る
          </Link>
          <button
            type="button"
            onClick={() => startTransition(() => logoutAction())}
            className="text-black/60 underline-offset-4 hover:underline dark:text-white/60"
          >
            ログアウト
          </button>
        </div>
      </header>

      {updatedAt !== null && (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          最終更新: {new Date(updatedAt).toLocaleString("ja-JP")}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(() => saveSettingsAction(values));
        }}
        className="mt-6 flex flex-col gap-6"
      >
        {GROUPED.map(({ group, fields }) => (
          <section
            key={group}
            className="rounded-2xl border border-black/10 p-5 dark:border-white/15"
          >
            <h2 className="text-sm font-bold tracking-wide text-black/70 dark:text-white/70">
              {group}
            </h2>
            <div className="mt-4 flex flex-col gap-5">
              {fields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  envValue={envValues[field.key] ?? ""}
                  overridden={overriddenSet.has(field.key)}
                  secretPresent={Boolean(secretPresent[field.key])}
                  disabled={pending}
                  onChange={(value) => set(field.key, value)}
                />
              ))}
            </div>
          </section>
        ))}

        {state.status !== "idle" && (
          <p
            className={`text-sm ${
              state.status === "ok"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-black px-8 py-2.5 font-bold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {pending ? "保存中…" : "保存する"}
          </button>

          {confirmingReset ? (
            <>
              <span className="text-sm text-black/60 dark:text-white/60">
                ここでの変更をすべて捨てて .env の内容に戻します。
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmingReset(false);
                  run(resetSettingsAction);
                }}
                className="rounded-full border border-red-400 px-5 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                戻す
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingReset(true)}
              className="text-sm text-black/60 underline-offset-4 hover:underline disabled:opacity-50 dark:text-white/60"
            >
              .env の内容に戻す
            </button>
          )}
        </div>
      </form>

      <PasswordSection passwordSource={passwordSource} />
    </div>
  );
}

function Field({
  field,
  value,
  envValue,
  overridden,
  secretPresent,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: string;
  envValue: string;
  overridden: boolean;
  secretPresent: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `setting-${field.key}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {field.label}
        </label>
        <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-black/55 dark:bg-white/[0.08] dark:text-white/55">
          {field.env}
        </code>
        {overridden && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
            .env から変更
          </span>
        )}
        {field.kind === "secret" && (
          <span className="text-[11px] text-black/50 dark:text-white/50">
            {secretPresent ? "設定済み" : "未設定"}
          </span>
        )}
      </div>

      {field.kind === "boolean" ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === "true"}
            disabled={disabled}
            onChange={(event) =>
              onChange(event.target.checked ? "true" : "false")
            }
            className="size-4 accent-black dark:accent-white"
          />
          <span className="text-black/70 dark:text-white/70">
            {value === "true" ? "オン" : "オフ"}
          </span>
        </label>
      ) : field.kind === "list" ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          type={
            field.kind === "secret"
              ? "password"
              : field.kind === "number"
                ? "number"
                : "text"
          }
          inputMode={field.kind === "number" ? "decimal" : undefined}
          min={field.min}
          step={field.step}
          value={value}
          disabled={disabled}
          autoComplete={field.kind === "secret" ? "new-password" : "off"}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )}

      <p className="text-xs text-black/50 dark:text-white/50">
        {field.description}
        {overridden && field.kind !== "secret" && (
          <span className="ml-1 text-black/40 dark:text-white/40">
            （.env では {envValue === "" ? "未設定" : envValue}）
          </span>
        )}
      </p>
    </div>
  );
}

function PasswordSection({
  passwordSource,
}: {
  passwordSource: "panel" | "env";
}) {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    INITIAL_STATE,
  );

  return (
    <details className="mt-8 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <summary className="cursor-pointer text-sm font-bold tracking-wide text-black/70 dark:text-white/70">
        パネルのパスワードを変更
      </summary>

      <p className="mt-3 text-xs text-black/50 dark:text-white/50">
        現在のパスワードは
        {passwordSource === "panel"
          ? "このパネルで設定されたもの"
          : ".env の PANEL_PASSWORD"}
        です。ここで変更すると保存先はパネル側になり、.env の値は使われなくなります。
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input
          type="password"
          name="currentPassword"
          placeholder="現在のパスワード"
          autoComplete="current-password"
          disabled={pending}
          className={inputClass}
        />
        <input
          type="password"
          name="password"
          placeholder="新しいパスワード（8 文字以上）"
          autoComplete="new-password"
          disabled={pending}
          className={inputClass}
        />
        <input
          type="password"
          name="confirmation"
          placeholder="新しいパスワード（確認）"
          autoComplete="new-password"
          disabled={pending}
          className={inputClass}
        />

        {state.status !== "idle" && (
          <p
            className={`text-sm ${
              state.status === "ok"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-full border border-black/20 px-6 py-2 text-sm font-bold transition hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/25 dark:hover:bg-white/[0.06]"
        >
          {pending ? "変更中…" : "変更する"}
        </button>
      </form>
    </details>
  );
}
