export interface Env {
  SETTINGS: KVNamespace;
  BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  GATEWAY_SHARED_SECRET: string;
}

export interface GuildSettings {
  enabled: boolean;
  twitterHost: string;
  instagramHost: string;
}

export const TWITTER_HOSTS = [
  "fxtwitter.com",
  "fixupx.com",
  "vxtwitter.com",
  "fixvx.com",
] as const;

export const INSTAGRAM_HOSTS = [
  "kkinstagram.com",
  "ddinstagram.com",
  "instagramez.com",
] as const;

export const DEFAULT_SETTINGS: GuildSettings = {
  enabled: true,
  twitterHost: "fxtwitter.com",
  instagramHost: "kkinstagram.com",
};

export interface MessageEvent {
  guild_id: string;
  channel_id: string;
  message_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    global_name: string | null;
    display_name: string | null;
    avatar_url: string;
  };
}

export interface Session {
  userId: string;
  username: string;
  avatarUrl: string | null;
  // MANAGE_GUILD 権限を持つギルド
  guilds: { id: string; name: string }[];
}
