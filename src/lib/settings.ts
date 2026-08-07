import "server-only";

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { DEFAULT_SCREEN_NAMES } from "@/config/screen-names";
import {
  type AppSettings,
  SETTING_FIELDS,
  type SettingKey,
  diffSettings,
  parseScreenNames,
} from "@/lib/settings-schema";

/**
 * 実行時の設定。
 *
 * 素の既定値は .env（環境変数）で決まり、設定パネルで変更したぶんだけを
 * JSON ファイルに「差分」として保存する。こうしておくと、パネルで触っていない
 * 項目は .env を書き換えればそのまま反映される。
 *
 * 同じファイルにパネルのパスワード（scrypt ハッシュ）とセッション署名鍵も置く。
 * どちらもサーバー内部だけで使い、クライアントには一切渡さない。
 */

/** パネルで変更した差分の保存先 */
const SETTINGS_FILE = process.env.SETTINGS_FILE ?? ".cache/settings.json";

interface SettingsStore {
  /** .env 由来の値と異なる項目だけを持つ */
  overrides: Partial<Record<SettingKey, unknown>>;
  /** パネルで設定したパスワード。未設定なら .env の PANEL_PASSWORD を使う。 */
  password?: { salt: string; hash: string };
  /** セッション Cookie の署名鍵 */
  sessionSecret?: string;
  updatedAt?: number;
}

const EMPTY_STORE: SettingsStore = { overrides: {} };

const globalForSettings = globalThis as unknown as {
  __buzzSettingsStore?: SettingsStore;
  __buzzSettingsWrite?: Promise<void>;
};

function settingsPath(): string {
  return path.isAbsolute(SETTINGS_FILE)
    ? SETTINGS_FILE
    : // 実行時にしか決まらないパス。バンドラに追跡させない。
      path.join(/* turbopackIgnore: true */ process.cwd(), SETTINGS_FILE);
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

/** .env と組み込みの既定値だけで組み立てた設定（パネルで未変更の状態） */
export function getEnvSettings(): AppSettings {
  const untilRaw = Number(process.env.UNTIL_MONTHS_AGO);

  return {
    authToken: process.env.X_AUTH_TOKEN?.trim() ?? "",
    client: process.env.X_CLIENT?.trim() || "web",
    proxy: process.env.X_PROXY?.trim() ?? "",
    screenNames: parseScreenNames(process.env.SCREEN_NAMES ?? ""),
    minLikes: envNumber("MIN_LIKES", 10000),
    requireImages: envBoolean("REQUIRE_IMAGES", true),
    untilMonthsAgo:
      Number.isFinite(untilRaw) && untilRaw > 0 ? untilRaw : null,
    maxConcurrentEnumerations: Math.max(
      1,
      Math.floor(envNumber("MAX_CONCURRENT_ENUMERATIONS", 2)),
    ),
    maxPages: envNumber("MAX_PAGES", 40),
    pageDelayMs: envNumber("PAGE_DELAY_MS", 400),
    maxSyncPages: envNumber("MAX_SYNC_PAGES", 10),
    cacheTtlMs: envNumber("CACHE_TTL_MS", 24 * 60 * 60 * 1000),
    cacheDir: process.env.CACHE_DIR?.trim() || ".cache/buzz-pools",
    weightByPoolSize: envBoolean("WEIGHT_BY_POOL_SIZE", false),
  };
}

/**
 * 保存された差分を .env 由来の値に重ねる。
 *
 * ファイルは手で書き換えられる前提なので、型が合わない値は黙って捨てる。
 */
function applyOverrides(
  base: AppSettings,
  overrides: Partial<Record<SettingKey, unknown>>,
): AppSettings {
  const merged: Record<string, unknown> = { ...base };

  for (const field of SETTING_FIELDS) {
    const value = overrides[field.key];
    if (value === undefined) continue;

    switch (field.kind) {
      case "secret":
      case "text":
        if (typeof value === "string") merged[field.key] = value;
        break;

      case "list":
        if (Array.isArray(value)) {
          merged[field.key] = value.filter(
            (name): name is string => typeof name === "string",
          );
        }
        break;

      case "boolean":
        if (typeof value === "boolean") merged[field.key] = value;
        break;

      case "number":
        if (value === null) {
          if (field.nullable) merged[field.key] = null;
        } else if (typeof value === "number" && Number.isFinite(value)) {
          merged[field.key] = Math.max(field.min ?? 0, value);
        }
        break;
    }
  }

  return merged as unknown as AppSettings;
}

async function readStore(): Promise<SettingsStore> {
  if (globalForSettings.__buzzSettingsStore) {
    return globalForSettings.__buzzSettingsStore;
  }

  let store = EMPTY_STORE;
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SettingsStore>;
    store = {
      overrides:
        parsed.overrides && typeof parsed.overrides === "object"
          ? parsed.overrides
          : {},
      password: parsed.password,
      sessionSecret: parsed.sessionSecret,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    // 未作成・壊れている場合は .env のままで動かす
  }

  globalForSettings.__buzzSettingsStore = store;
  return store;
}

/**
 * 保存ファイルを書き換える。
 *
 * 書き込みは直列化し、途中で落ちても壊れないよう一時ファイル経由で差し替える。
 */
async function updateStore(
  mutate: (store: SettingsStore) => SettingsStore,
): Promise<SettingsStore> {
  const previous = globalForSettings.__buzzSettingsWrite ?? Promise.resolve();
  let next!: SettingsStore;

  const task = previous
    .catch(() => {})
    .then(async () => {
      next = mutate(await readStore());
      next.updatedAt = Date.now();
      globalForSettings.__buzzSettingsStore = next;

      const file = settingsPath();
      const tmp = `${file}.tmp`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
      await fs.rename(tmp, file);
    });

  globalForSettings.__buzzSettingsWrite = task;
  await task;
  return next;
}

/** 実際に使う設定（.env に、パネルで変更したぶんを重ねたもの） */
export async function getSettings(): Promise<AppSettings> {
  const store = await readStore();
  return applyOverrides(getEnvSettings(), store.overrides);
}

/** パネル表示用に、現在値とあわせて「どの項目が .env から変更されているか」を返す */
export async function getSettingsForPanel(): Promise<{
  settings: AppSettings;
  env: AppSettings;
  overridden: SettingKey[];
  updatedAt: number | null;
}> {
  const store = await readStore();
  const env = getEnvSettings();
  const settings = applyOverrides(env, store.overrides);

  return {
    settings,
    env,
    overridden: diffSettings(settings, env),
    updatedAt: store.updatedAt ?? null,
  };
}

/** 新しい設定を保存する。.env と同じ値になった項目は差分から外す。 */
export async function saveSettings(next: AppSettings): Promise<void> {
  const env = getEnvSettings();
  const changed = diffSettings(next, env);

  const overrides: Partial<Record<SettingKey, unknown>> = {};
  for (const key of changed) overrides[key] = next[key];

  await updateStore((store) => ({ ...store, overrides }));
}

/** パネルでの変更をすべて捨てて .env の状態に戻す */
export async function resetSettings(): Promise<void> {
  await updateStore((store) => ({ ...store, overrides: {} }));
}

/** 対象スクリーンネーム。未指定なら既定の一覧を使う。 */
export function resolveScreenNames(settings: AppSettings): string[] {
  return settings.screenNames.length > 0
    ? settings.screenNames
    : [...DEFAULT_SCREEN_NAMES];
}

/* ------------------------------------------------------------------ *
 * パネルのパスワードとセッション署名鍵
 * ------------------------------------------------------------------ */

const SCRYPT_KEY_LENGTH = 64;

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** 長さの違いを漏らさずに比較する */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual は長さが違うと例外を投げるので、先にハッシュを挟んで長さを揃える
  const digestA = crypto.createHash("sha256").update(bufA).digest();
  const digestB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/** パネルを開けるパスワードが用意されているか（なければパネルごと無効） */
export async function isPanelConfigured(): Promise<boolean> {
  if (process.env.PANEL_PASSWORD?.trim()) return true;
  const store = await readStore();
  return Boolean(store.password);
}

/** パネルのパスワードが .env と保存済みのどちらに由来するか */
export async function getPasswordSource(): Promise<"panel" | "env" | "none"> {
  const store = await readStore();
  if (store.password) return "panel";
  if (process.env.PANEL_PASSWORD?.trim()) return "env";
  return "none";
}

export async function verifyPanelPassword(password: string): Promise<boolean> {
  const store = await readStore();

  if (store.password) {
    const expected = Buffer.from(store.password.hash, "hex");
    const actual = await scrypt(password, store.password.salt);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  const fromEnv = process.env.PANEL_PASSWORD?.trim();
  if (!fromEnv) return false;
  return safeEqual(password, fromEnv);
}

export async function setPanelPassword(password: string): Promise<void> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt)).toString("hex");
  // パスワードを変えたら既存のセッションは無効にしたいので署名鍵も入れ替える
  await updateStore((store) => ({
    ...store,
    password: { salt, hash },
    sessionSecret: crypto.randomBytes(32).toString("hex"),
  }));
}

/**
 * セッション Cookie の署名鍵。
 * .env で固定していなければ、初回に生成して保存ファイルに置く。
 */
export async function getSessionSecret(): Promise<string> {
  const fromEnv = process.env.PANEL_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const store = await readStore();
  if (store.sessionSecret) return store.sessionSecret;

  const secret = crypto.randomBytes(32).toString("hex");
  await updateStore((current) => ({
    ...current,
    sessionSecret: current.sessionSecret ?? secret,
  }));
  return (await readStore()).sessionSecret ?? secret;
}

/**
 * 現在のパスワードを表す短い指紋。
 * セッションの署名に混ぜておくと、パスワードを変えた時点で
 * 発行済みのセッションがすべて無効になる。
 */
export async function getPasswordFingerprint(): Promise<string> {
  const store = await readStore();
  const material = store.password
    ? `panel:${store.password.salt}:${store.password.hash}`
    : `env:${process.env.PANEL_PASSWORD ?? ""}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}
