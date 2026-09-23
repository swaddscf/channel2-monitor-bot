export type SupportedPlatform = "tiktok" | "instagram" | "facebook" | "snapchat" | "pinterest" | "twitter";

export type MediaChoice = "video" | "audio" | "image" | "story";

export type TikTokAccount = {
  nickname?: string;
  username?: string;
  followers?: number;
  following?: number;
  posts?: number;
  hearts?: number;
  region?: string;
  verified?: boolean;
  signature?: string;
  avatarUrl?: string;
  profileUrl?: string;
};

export type InspectResult = {
  platform: SupportedPlatform;
  title: string;
  choices: MediaChoice[];
  durationSeconds?: number;
  thumbnail?: string;
  imageCount?: number;
  account?: TikTokAccount;
};

export type TelegramFrom = {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number | string; type: string };
  from?: TelegramFrom;
  text?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramFrom;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type ForcedSubscriptionKind = "channel" | "group" | "bot";

export type ForcedSubscription = {
  id: string;
  target: string;
  inviteUrl: string;
  label: string;
  kind: ForcedSubscriptionKind;
  createdAt: Date;
};
