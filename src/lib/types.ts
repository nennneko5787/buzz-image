/** サーバー・クライアント双方で使う表示用の型 */

export type BuzzMediaKind = "photo" | "video" | "gif";

export interface BuzzMedia {
  kind: BuzzMediaKind;
  /** 表示する画像 URL（動画・GIF はサムネイル） */
  url: string;
  width: number;
  height: number;
  alt?: string;
  /** 動画・GIF の再生時間（秒） */
  durationSec?: number;
}

export interface BuzzTweet {
  id: string;
  url: string;
  /** t.co を展開し、末尾のメディアリンクを除いた本文 */
  text: string;
  createdAt: string;
  author: {
    name: string;
    username: string;
    avatarUrl: string;
    verified: boolean;
  };
  stats: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views: number;
  };
  media: BuzzMedia[];
  possiblySensitive: boolean;
}

export interface RandomTweetResponse {
  tweet: BuzzTweet;
  /** 抽選に使ったスクリーンネーム */
  screenName: string;
  /** そのアカウントの候補ツイート数 */
  poolSize: number;
  /** そのアカウントの全期間を辿り終えているか（false の間は収集中） */
  poolComplete: boolean;
  criteria: { minLikes: number; requireImages: boolean };
}

/** 絞り込みのプルダウンに出すアカウントの見た目 */
export interface BuzzProfile {
  /** @ なしのスクリーンネーム */
  screenName: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
}

export interface BuzzAccount extends BuzzProfile {
  /** ストア済みの候補ツイート数 */
  storedCount: number;
  /** 全期間を辿り終えているか（false の間は収集中） */
  complete: boolean;
  /** 表示名とアイコンが取れているか。false ならスクリーンネームだけで表示する。 */
  hasProfile: boolean;
}

export interface AccountsResponse {
  accounts: BuzzAccount[];
}

/** ストア済み一覧の並び順 */
export type StoredSort = "new" | "old" | "likes";

export interface StoredTweetsResponse {
  tweets: BuzzTweet[];
  /** 条件に合う総数（ページングする前） */
  total: number;
  offset: number;
  limit: number;
}

/** ストア済み一覧を 1 度に読み込む件数 */
export const STORED_PAGE_SIZE = 20;
