import { Env, MessageEvent, GuildSettings, DEFAULT_SETTINGS } from "./types";
import { replaceLinks } from "./replace";
import { deleteMessage, getOrCreateWebhook, executeWebhook } from "./discord";

/** リンクを含むメッセージを置換して本人風に再投稿する */
export async function processMessageEvent(
  env: Env,
  ev: MessageEvent,
): Promise<{ ok?: boolean; skipped?: string; error?: string }> {
  const settings =
    (await env.SETTINGS.get<GuildSettings>(`settings:${ev.guild_id}`, "json")) ??
    DEFAULT_SETTINGS;
  if (!settings.enabled) return { skipped: "disabled" };

  const { content, changed } = replaceLinks(ev.content, settings);
  if (!changed) return { skipped: "no-change" };

  // 1) Webhook確保(権限がなければ何もしない=メッセージを消さない)
  const hook = await getOrCreateWebhook(env, ev.channel_id);
  if (!hook) return { error: "webhook-unavailable" };

  // 2) 元メッセージを削除
  const deleted = await deleteMessage(env, ev.channel_id, ev.message_id);
  if (!deleted) return { error: "delete-failed" };

  // 3) 本人風に再投稿
  const username =
    ev.author.display_name ?? ev.author.global_name ?? ev.author.username;
  const posted = await executeWebhook(env, hook, ev.channel_id, {
    content,
    username,
    avatarUrl: ev.author.avatar_url,
  });
  return { ok: posted };
}
