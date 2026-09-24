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
  successful_payment?: TelegramSuccessfulPayment;
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
  pre_checkout_query?: TelegramPreCheckoutQuery;
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

export type SubscriptionPlan = {
  id: string;
  name: string;
  durationDays: number;
  stars: number;
  active: boolean;
  createdAt: Date;
};

export type TelegramSuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
};

export type TelegramPreCheckoutQuery = {
  id: string;
  from: TelegramFrom;
  currency: string;
  total_amount: number;
  invoice_payload: string;
};
