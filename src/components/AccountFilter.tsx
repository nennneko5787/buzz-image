"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { AccountsResponse, BuzzAccount } from "@/lib/types";

/**
 * 選んだアカウントの保存先。ページを移っても絞り込みを引き継ぐ。
 *
 * 選択そのものは React の state ではなく localStorage 側に置き、
 * {@link useSyncExternalStore} で読む。サーバー描画では「全選択」を返し、
 * ハイドレート後に保存済みの内容へ切り替わる。
 */
const STORAGE_KEY = "buzz-image.selected-accounts";

const selectionListeners = new Set<() => void>();

/** localStorage が使えないときでも、その場の絞り込みは効かせるための控え */
let memorySelection: string | null = null;

function readRawSelection(): string | null {
  if (memorySelection !== null) return memorySelection;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);

  // 別のタブで変えたぶんも拾う
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    memorySelection = null;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    selectionListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeSelection(names: string[]): void {
  memorySelection = JSON.stringify(names);
  try {
    window.localStorage.setItem(STORAGE_KEY, memorySelection);
  } catch {
    // プライベートモードなどで保存できなくても、その場の絞り込みは効く
  }
  for (const listener of [...selectionListeners]) listener();
}

/** 2 つの選択が同じ中身か（並び順は問わない） */
export function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((name) => name.toLowerCase()));
  return b.every((name) => set.has(name.toLowerCase()));
}

/** 保存されていた選択を、いま設定されているアカウントに突き合わせる */
function parseSelection(
  raw: string | null,
  available: string[],
): string[] | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const wanted = new Set(
      parsed
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.toLowerCase()),
    );
    const names = available.filter((name) => wanted.has(name.toLowerCase()));

    // 保存されていたアカウントが 1 つも残っていないなら、
    // 対象の設定ごと入れ替わったとみなして無視する
    if (wanted.size > 0 && names.length === 0) return null;
    return names;
  } catch {
    return null;
  }
}

/**
 * 選択中のアカウントを返す。保存されたものが無ければ全選択。
 *
 * サーバー描画（＝全選択）のまま出したものと、復元した選択とが食い違うことが
 * あるので、そのときは {@link onRestore} で呼び出し側に読み直す機会を渡す。
 */
export function useAccountSelection(
  accounts: BuzzAccount[],
  onRestore?: (screenNames: string[]) => void,
) {
  const all = useMemo(
    () => accounts.map((account) => account.screenName),
    [accounts],
  );

  const raw = useSyncExternalStore(
    subscribeSelection,
    readRawSelection,
    () => null,
  );
  const selected = useMemo(
    () => parseSelection(raw, all) ?? all,
    [all, raw],
  );

  const restoreRef = useRef(onRestore);
  useEffect(() => {
    restoreRef.current = onRestore;
  });

  /**
   * 復元ぶんの読み直しはもう要らないか。
   *
   * ハイドレート直後の 1 回目はまだ「全選択」のままなので、ここで打ち切らずに
   * 保存済みの内容へ切り替わった回を待つ。ユーザーが自分で選び直したときは
   * そちら側で読み直すので、{@link setSelected} の時点で降ろしておく。
   */
  const restoreHandled = useRef(false);
  useEffect(() => {
    if (restoreHandled.current) return;
    if (sameSelection(selected, all)) return;
    restoreHandled.current = true;
    restoreRef.current?.(selected);
  }, [all, selected]);

  const setSelected = useCallback((names: string[]) => {
    restoreHandled.current = true;
    writeSelection(names);
  }, []);

  return { all, selected, setSelected };
}

function statusLabel(account: BuzzAccount): string {
  if (account.storedCount === 0) return "未収集";
  const count = `${account.storedCount.toLocaleString("ja-JP")} 件`;
  return account.complete ? count : `${count}・収集中`;
}

function Avatar({ account }: { account: BuzzAccount }) {
  if (!account.avatarUrl) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/[0.08] text-xs font-bold text-black/40 dark:bg-white/[0.12] dark:text-white/40">
        {account.screenName.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      src={account.avatarUrl}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded-full"
      unoptimized
    />
  );
}

/**
 * アカウントを選ぶプルダウン。
 *
 * 開いているあいだの操作は手元（draft）にためておき、閉じたときにまとめて
 * {@link onChange} へ渡す。チェックするたびに引き直さないようにするため。
 */
export function AccountFilter({
  accounts,
  selected,
  onChange,
  disabled,
}: {
  accounts: BuzzAccount[];
  selected: string[];
  /** プルダウンを閉じたときに、選択が変わっていれば呼ばれる */
  onChange: (screenNames: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  /** 表示用のアカウント。プロフィールが欠けていれば取り直して差し替える。 */
  const [resolved, setResolved] = useState(accounts);
  const containerRef = useRef<HTMLDivElement>(null);

  // 親が選択を変えたら（前回ぶんの復元など）、編集中の内容も追随させる
  const [seededFrom, setSeededFrom] = useState(selected);
  if (seededFrom !== selected) {
    setSeededFrom(selected);
    setDraft(selected);
  }

  const [profileSeed, setProfileSeed] = useState(accounts);
  if (profileSeed !== accounts) {
    setProfileSeed(accounts);
    setResolved(accounts);
  }

  // 表示名やアイコンが未取得のアカウントがあれば、サーバー側で埋めてもらう
  useEffect(() => {
    if (accounts.every((account) => account.hasProfile)) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/accounts?profiles=1", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as AccountsResponse;
        if (!cancelled && Array.isArray(json.accounts)) {
          setResolved(json.accounts);
        }
      } catch {
        // 取れなくてもスクリーンネームだけで選べるので黙って諦める
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts]);

  const close = useCallback(() => {
    setOpen(false);
    if (!sameSelection(draft, selected)) onChange(draft);
  }, [draft, onChange, selected]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const selectedSet = new Set(draft.map((name) => name.toLowerCase()));

  const toggle = (screenName: string) => {
    const key = screenName.toLowerCase();
    setDraft((current) =>
      current.some((name) => name.toLowerCase() === key)
        ? current.filter((name) => name.toLowerCase() !== key)
        : [...current, screenName],
    );
  };

  const label =
    draft.length === accounts.length
      ? `全 ${accounts.length} アカウント`
      : `${draft.length} / ${accounts.length} アカウント`;
  const preview = resolved
    .filter((account) => selectedSet.has(account.screenName.toLowerCase()))
    .slice(0, 3);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center gap-2 rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.06]"
      >
        {preview.length > 0 && (
          <span className="flex -space-x-2">
            {preview.map((account) => (
              <span
                key={account.screenName}
                className="rounded-full ring-2 ring-zinc-50 dark:ring-black"
              >
                <Avatar account={account} />
              </span>
            ))}
          </span>
        )}
        <span className="flex-1 truncate text-left">{label}</span>
        <span aria-hidden className="text-xs text-black/45 dark:text-white/45">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/15 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2 border-b border-black/10 px-3 py-2 dark:border-white/15">
            <span className="text-xs text-black/50 dark:text-white/50">
              {draft.length} 件選択中
            </span>
            <span className="flex gap-3 text-xs">
              <button
                type="button"
                onClick={() =>
                  setDraft(resolved.map((account) => account.screenName))
                }
                className="underline-offset-4 hover:underline"
              >
                すべて選択
              </button>
              <button
                type="button"
                onClick={() => setDraft([])}
                className="underline-offset-4 hover:underline"
              >
                すべて解除
              </button>
            </span>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {resolved.map((account) => (
              <li
                key={account.screenName}
                className="flex items-center border-b border-black/[0.06] last:border-b-0 hover:bg-black/[0.03] dark:border-white/[0.08] dark:hover:bg-white/[0.05]"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(account.screenName.toLowerCase())}
                    onChange={() => toggle(account.screenName)}
                    className="size-4 shrink-0 accent-black dark:accent-white"
                  />
                  <Avatar account={account} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">
                        {account.name || account.screenName}
                      </span>
                      {account.verified && (
                        <span
                          aria-label="認証済み"
                          title="認証済み"
                          className="shrink-0 text-xs text-sky-500"
                        >
                          ✓
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-black/50 dark:text-white/50">
                      @{account.screenName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-black/45 dark:text-white/45">
                    {statusLabel(account)}
                  </span>
                </label>
                <a
                  href={`https://x.com/${account.screenName}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`@${account.screenName} を X で開く`}
                  className="shrink-0 px-3 py-2 text-xs text-black/40 hover:text-sky-600 dark:text-white/40 dark:hover:text-sky-400"
                >
                  ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
