/**
 * パネルから編集できる設定の「形」の定義。
 *
 * サーバー・クライアント双方から読むので、ここでは fs にも process.env にも触らない。
 * 環境変数からの既定値の解決とファイルへの永続化は server-only の
 * {@link file://./settings.ts} が担当する。
 */

export type SettingKey =
  | "authToken"
  | "client"
  | "proxy"
  | "screenNames"
  | "minLikes"
  | "requireImages"
  | "untilMonthsAgo"
  | "maxConcurrentEnumerations"
  | "maxPages"
  | "pageDelayMs"
  | "maxSyncPages"
  | "cacheTtlMs"
  | "cacheDir"
  | "weightByPoolSize";

export interface AppSettings {
  /** x.com の Cookie `auth_token` */
  authToken: string;
  /** エミュレートするクライアント */
  client: string;
  /** プロキシ（空文字なら使わない） */
  proxy: string;
  /** 対象スクリーンネーム（@ なし） */
  screenNames: string[];
  /** 収集するいいね数の下限 */
  minLikes: number;
  /** 画像付きツイートだけを対象にするか */
  requireImages: boolean;
  /** 何ヶ月前より古い投稿を対象にするか。null なら期間の制限なし。 */
  untilMonthsAgo: number | null;
  /** 候補の列挙を同時に走らせるアカウント数の上限 */
  maxConcurrentEnumerations: number;
  /** 全期間を辿るときのページ数の安全上限（1 ページ 40 件） */
  maxPages: number;
  /** 列挙中、ページ取得の間に空ける時間（ミリ秒） */
  pageDelayMs: number;
  /** 初回表示のために同期で辿るページ数の上限 */
  maxSyncPages: number;
  /** 候補プールのキャッシュ有効期間（ミリ秒） */
  cacheTtlMs: number;
  /** 候補プールのディスクキャッシュ先 */
  cacheDir: string;
  /** アカウントを候補数で重み付けして選ぶか */
  weightByPoolSize: boolean;
}

export type SettingKind = "text" | "secret" | "number" | "boolean" | "list";

export interface SettingField {
  key: SettingKey;
  /** 対応する環境変数名。パネルで未変更ならこちらが効く。 */
  env: string;
  label: string;
  description: string;
  kind: SettingKind;
  /** パネル上の見出し */
  group: string;
  min?: number;
  step?: number;
  /** 整数に丸めるか（number のみ） */
  integer?: boolean;
  /** 空欄を「制限なし（null）」として受け付けるか（number のみ） */
  nullable?: boolean;
  placeholder?: string;
}

/** パネルの表示順。ここに並べた順にセクション分けされる。 */
export const SETTING_GROUPS = ["接続", "対象", "収集", "キャッシュ"] as const;

export const SETTING_FIELDS: readonly SettingField[] = [
  {
    key: "authToken",
    env: "X_AUTH_TOKEN",
    label: "auth_token",
    description:
      "x.com にログイン中のブラウザの Cookie auth_token の値。空欄のままなら現在の値を保持します。",
    kind: "secret",
    group: "接続",
    placeholder: "変更するときだけ入力",
  },
  {
    key: "client",
    env: "X_CLIENT",
    label: "クライアント",
    description:
      "エミュレートするクライアント（web / android / iphone / ipad / mac / old / tweetdeck）。",
    kind: "text",
    group: "接続",
    placeholder: "web",
  },
  {
    key: "proxy",
    env: "X_PROXY",
    label: "プロキシ",
    description: "protocol://user:pass@host:port の形式。空欄なら使いません。",
    kind: "text",
    group: "接続",
    placeholder: "（なし）",
  },
  {
    key: "screenNames",
    env: "SCREEN_NAMES",
    label: "対象スクリーンネーム",
    description:
      "カンマまたは改行区切り。@ は付けても付けなくても構いません。空欄なら既定の一覧を使います。",
    kind: "list",
    group: "対象",
  },
  {
    key: "minLikes",
    env: "MIN_LIKES",
    label: "いいね数の下限",
    description:
      "候補として収集するいいね数の下限。画面側ではこの値以上でしか絞り込めません。",
    kind: "number",
    group: "対象",
    min: 0,
    step: 1000,
    integer: true,
  },
  {
    key: "requireImages",
    env: "REQUIRE_IMAGES",
    label: "画像付きに限定する",
    description: "画像・動画が添付されたツイートだけを対象にします。",
    kind: "boolean",
    group: "対象",
  },
  {
    key: "untilMonthsAgo",
    env: "UNTIL_MONTHS_AGO",
    label: "何ヶ月前より古い投稿を対象にするか",
    description:
      "3 なら「3 ヶ月前より前」の投稿だけが対象。小数も使えます（0.5 = 約 15 日）。空欄なら期間の制限なし。",
    kind: "number",
    group: "対象",
    min: 0,
    step: 0.5,
    nullable: true,
    placeholder: "（制限なし）",
  },
  {
    key: "maxConcurrentEnumerations",
    env: "MAX_CONCURRENT_ENUMERATIONS",
    label: "同時に列挙できるアカウント数",
    description:
      "候補の収集（列挙）を同時に走らせるアカウント数の上限。増やすと収集は速くなりますが、レート制限に当たりやすくなります。",
    kind: "number",
    group: "収集",
    min: 1,
    step: 1,
    integer: true,
  },
  {
    key: "maxPages",
    env: "MAX_PAGES",
    label: "1 アカウントあたりのページ数上限",
    description:
      "全期間を辿るときの安全上限（1 ページ 40 件）。通常はカーソルが先に尽きます。",
    kind: "number",
    group: "収集",
    min: 1,
    step: 1,
    integer: true,
  },
  {
    key: "pageDelayMs",
    env: "PAGE_DELAY_MS",
    label: "ページ取得の間隔（ミリ秒）",
    description: "列挙中、次のページを取りにいくまでに空ける時間。",
    kind: "number",
    group: "収集",
    min: 0,
    step: 100,
    integer: true,
  },
  {
    key: "maxSyncPages",
    env: "MAX_SYNC_PAGES",
    label: "初回表示で同期に辿るページ数",
    description:
      "期間指定などで先頭ページに該当が 0 件のことがあるため、1 件見つかるまでこの数まで同期で辿ります。",
    kind: "number",
    group: "収集",
    min: 1,
    step: 1,
    integer: true,
  },
  {
    key: "cacheTtlMs",
    env: "CACHE_TTL_MS",
    label: "キャッシュ有効期間（ミリ秒）",
    description: "候補プールを作り直すまでの時間。既定は 86400000（24 時間）。",
    kind: "number",
    group: "キャッシュ",
    min: 0,
    step: 3600000,
    integer: true,
  },
  {
    key: "cacheDir",
    env: "CACHE_DIR",
    label: "ディスクキャッシュ先",
    description:
      "候補プールを保存するディレクトリ。相対パスはプロジェクトルート基準です。",
    kind: "text",
    group: "キャッシュ",
    placeholder: ".cache/buzz-pools",
  },
  {
    key: "weightByPoolSize",
    env: "WEIGHT_BY_POOL_SIZE",
    label: "候補数で重み付けして抽選する",
    description:
      "オフならアカウントごとに等確率、オンなら全アカウントの全ツイートの中で一様になります。",
    kind: "boolean",
    group: "キャッシュ",
  },
];

const FIELD_BY_KEY = new Map(SETTING_FIELDS.map((f) => [f.key, f]));

/** 秘匿値（パネルに現在値を出さない項目） */
export const SECRET_KEYS: readonly SettingKey[] = SETTING_FIELDS.filter(
  (f) => f.kind === "secret",
).map((f) => f.key);

/** パネルのフォームがやり取りする形。すべて文字列で扱う。 */
export type SettingsFormValues = Record<SettingKey, string>;

/** 設定パネルの Server Action が返す結果 */
export interface PanelActionState {
  status: "idle" | "ok" | "error";
  message: string;
}

/** スクリーンネームの入力欄（カンマ・改行区切り）を配列にする */
export function parseScreenNames(raw: string): string[] {
  const names = raw
    .split(/[,\n]/)
    .map((name) => name.trim().replace(/^@/, ""))
    .filter(Boolean);

  // 重複除去（大文字小文字は区別しない）
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 現在の設定をフォームの初期値に落とす。秘匿値は空欄にする。 */
export function toFormValues(settings: AppSettings): SettingsFormValues {
  const values = {} as SettingsFormValues;

  for (const field of SETTING_FIELDS) {
    if (field.kind === "secret") {
      values[field.key] = "";
      continue;
    }
    const value = settings[field.key];
    if (value === null || value === undefined) {
      values[field.key] = "";
    } else if (Array.isArray(value)) {
      values[field.key] = value.join(", ");
    } else {
      values[field.key] = String(value);
    }
  }

  return values;
}

/**
 * フォームの入力を設定に落とす。
 *
 * 未入力の秘匿値や、そもそも送られてこなかった項目は {@link current} を引き継ぐ。
 * 不正な値は採用せず、代わりにエラーメッセージを返す。
 */
export function parseFormValues(
  values: Partial<SettingsFormValues>,
  current: AppSettings,
): { settings: AppSettings; errors: string[] } {
  const next: Record<string, unknown> = { ...current };
  const errors: string[] = [];

  for (const field of SETTING_FIELDS) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    const trimmed = raw.trim();

    switch (field.kind) {
      case "secret":
        // 空欄は「変更しない」の意味。消したいときは明示的に別の値を入れる。
        if (trimmed) next[field.key] = trimmed;
        break;

      case "text":
        next[field.key] = trimmed;
        break;

      case "list":
        next[field.key] = parseScreenNames(raw);
        break;

      case "boolean":
        next[field.key] = trimmed.toLowerCase() === "true";
        break;

      case "number": {
        if (!trimmed) {
          if (field.nullable) {
            next[field.key] = null;
          } else {
            errors.push(`${field.label}: 値を入力してください`);
          }
          break;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
          errors.push(`${field.label}: 数値で入力してください`);
          break;
        }
        const min = field.min ?? 0;
        if (parsed < min) {
          errors.push(`${field.label}: ${min} 以上で入力してください`);
          break;
        }
        next[field.key] = field.integer ? Math.floor(parsed) : parsed;
        break;
      }
    }
  }

  return { settings: next as unknown as AppSettings, errors };
}

/** 2 つの設定を比べて、値が違うキーだけを返す */
export function diffSettings(
  next: AppSettings,
  base: AppSettings,
): SettingKey[] {
  return SETTING_FIELDS.map((f) => f.key).filter((key) => {
    const a = next[key];
    const b = base[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length !== b.length || a.some((v, i) => v !== b[i]);
    }
    return a !== b;
  });
}

export function getSettingField(key: SettingKey): SettingField {
  const field = FIELD_BY_KEY.get(key);
  if (!field) throw new Error(`未知の設定キー: ${key}`);
  return field;
}

/**
 * ユーザーが指定したいいね数のしきい値を、実際に使える値に正規化する。
 * 未指定・不正値・下限未満はすべて下限に丸める。
 */
export function resolveMinLikes(
  raw: string | number | null | undefined,
  floor: number,
): number {
  if (raw === null || raw === undefined || raw === "") return floor;
  const value = Number(raw);
  if (!Number.isFinite(value)) return floor;
  return Math.max(floor, Math.floor(value));
}

/** 対象期間の終端（この日より前の投稿だけを対象にする）。制限なしなら null。 */
export function getUntilDate(untilMonthsAgo: number | null): Date | null {
  if (untilMonthsAgo === null || untilMonthsAgo <= 0) return null;
  const until = new Date();
  until.setMonth(until.getMonth() - Math.floor(untilMonthsAgo));
  // 小数ぶんは日数に換算して引く（1 ヶ月 = 30 日とみなす）
  const fraction = untilMonthsAgo - Math.floor(untilMonthsAgo);
  if (fraction > 0) until.setDate(until.getDate() - Math.round(fraction * 30));
  until.setHours(0, 0, 0, 0);
  return until;
}

/** X の検索演算子 `until:` に渡す YYYY-MM-DD 形式 */
export function formatSearchDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
