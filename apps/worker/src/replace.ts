import type { GuildSettings } from "./types";

const TWITTER_RE =
  /https?:\/\/(?:www\.)?(?:twitter|x)\.com(\/\w+\/status\/\d+)(?:\?[^\s<>]*)?/gi;

const INSTAGRAM_RE =
  /https?:\/\/(?:www\.)?instagram\.com(\/(?:p|reel|reels|tv|share)\/[\w-]+)\/?(?:\?[^\s<>]*)?/gi;

/** 対象URLを置換ドメインに差し替える。変更がなければ changed=false */
export function replaceLinks(
  content: string,
  settings: GuildSettings,
): { content: string; changed: boolean } {
  let changed = false;

  let out = content.replace(TWITTER_RE, (match, path: string, offset: number) => {
    // <URL> で囲まれている(Embed抑制済み)場合はそのまま
    if (isSuppressed(content, offset, match.length)) return match;
    changed = true;
    return `https://${settings.twitterHost}${path}`;
  });

  out = out.replace(INSTAGRAM_RE, (match, path: string, offset: number) => {
    if (isSuppressed(out, offset, match.length)) return match;
    changed = true;
    return `https://${settings.instagramHost}${path}`;
  });

  return { content: out, changed };
}

function isSuppressed(text: string, offset: number, len: number): boolean {
  return text[offset - 1] === "<" && text[offset + len] === ">";
}
