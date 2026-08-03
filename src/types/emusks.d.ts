/**
 * emusks はピュア JS (ESM) で型定義を同梱していないため、
 * このアプリで使う範囲だけ最小限の型を宣言する。
 * 実際の形は node_modules/emusks/src/parsers/*.js に対応。
 */
declare module "emusks" {
  export interface EmusksUser {
    id: string;
    name: string;
    username: string;
    description?: string;
    profile_picture: {
      url: string;
      shape: string;
    };
    verification: {
      verified?: boolean;
      premium_verified?: boolean | string;
    };
    stats: {
      followers: { count?: number };
      following?: number;
      posts?: number;
    };
  }

  export interface EmusksMediaSize {
    w: number;
    h: number;
    resize: string;
  }

  /** ツイートに紐づく生の media エンティティ */
  export interface EmusksMedia {
    id_str?: string;
    media_key?: string;
    /** "photo" | "video" | "animated_gif" */
    type: string;
    media_url_https?: string;
    url?: string;
    expanded_url?: string;
    display_url?: string;
    ext_alt_text?: string;
    original_info?: { width?: number; height?: number };
    sizes?: Record<string, EmusksMediaSize>;
    video_info?: {
      aspect_ratio?: [number, number];
      duration_millis?: number;
      variants?: { bitrate?: number; content_type: string; url: string }[];
    };
  }

  export interface EmusksUrlEntity {
    url: string;
    expanded_url: string;
    display_url: string;
    indices?: [number, number];
  }

  export interface EmusksTweet {
    id: string;
    text: string;
    created_at: string;
    conversation_id?: string;
    in_reply_to_status_id?: string | null;
    user: EmusksUser | null;
    stats: {
      retweets: number;
      likes: number;
      replies: number;
      quotes: number;
      bookmarks: number;
      views: number;
    };
    engagement: {
      retweeted: boolean;
      liked: boolean;
      bookmarked: boolean;
    };
    media: EmusksMedia[];
    urls: EmusksUrlEntity[];
    hashtags: { text: string }[];
    user_mentions: { screen_name: string }[];
    source?: string;
    lang?: string;
    quoting: EmusksTweet | null;
    misc: {
      possibly_sensitive?: boolean;
      display_text_range?: [number, number];
    };
  }

  export interface EmusksTimeline {
    tweets: EmusksTweet[];
    users: EmusksUser[];
    nextCursor: string | null;
    previousCursor: string | null;
    raw: unknown;
  }

  export interface EmusksSearchOptions {
    count?: number;
    cursor?: string | null;
    querySource?: string;
    product?: string;
    variables?: Record<string, unknown>;
  }

  export interface EmusksLoginOptions {
    auth_token?: string;
    type?: "password";
    username?: string;
    password?: string;
    email?: string;
    phone?: string;
    client?: string | Record<string, unknown>;
    endpoint?:
      | "web"
      | "main"
      | "tweetdeck"
      | "web_twitter"
      | "main_twitter"
      | "tweetdeck_twitter";
    transactionIds?: boolean;
    proxy?: string;
    onRequest?: (type: string) => Promise<string | undefined>;
  }

  export default class Emusks {
    user?: EmusksUser;
    graphqlEndpoint: string;
    login(options: string | EmusksLoginOptions): Promise<EmusksUser | undefined>;
    elevate(password: string): Promise<unknown>;
    search: {
      tweets(
        query: string,
        opts?: EmusksSearchOptions,
      ): Promise<EmusksTimeline>;
      latest(
        query: string,
        opts?: EmusksSearchOptions,
      ): Promise<EmusksTimeline>;
      media(query: string, opts?: EmusksSearchOptions): Promise<EmusksTimeline>;
    };
    tweets: {
      get(id: string): Promise<EmusksTweet>;
    };
    users: {
      getByUsername(username: string): Promise<EmusksUser>;
    };
  }
}
