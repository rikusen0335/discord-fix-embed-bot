import type { Env } from "./types";

const API = "https://discord.com/api/v10";

async function rest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bot ${env.BOT_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function deleteMessage(
  env: Env,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const res = await rest(env, "DELETE", `/channels/${channelId}/messages/${messageId}`);
  return res.ok;
}

interface Webhook {
  id: string;
  token: string;
}

const WEBHOOK_NAME = "FixEmbed";

/** チャンネルのWebhookをKVキャッシュ付きで取得/作成 */
export async function getOrCreateWebhook(
  env: Env,
  channelId: string,
): Promise<Webhook | null> {
  const cacheKey = `webhook:${channelId}`;
  const cached = await env.SETTINGS.get<Webhook>(cacheKey, "json");
  if (cached) return cached;

  // 既存Webhookを探す
  const listRes = await rest(env, "GET", `/channels/${channelId}/webhooks`);
  if (listRes.ok) {
    const hooks = (await listRes.json()) as (Webhook & { name: string })[];
    const own = hooks.find((h) => h.name === WEBHOOK_NAME && h.token);
    if (own) {
      const hook = { id: own.id, token: own.token };
      await env.SETTINGS.put(cacheKey, JSON.stringify(hook));
      return hook;
    }
  }

  // なければ作成
  const createRes = await rest(env, "POST", `/channels/${channelId}/webhooks`, {
    name: WEBHOOK_NAME,
  });
  if (!createRes.ok) {
    console.error(`webhook create failed: ${createRes.status}`);
    return null;
  }
  const created = (await createRes.json()) as Webhook;
  const hook = { id: created.id, token: created.token };
  await env.SETTINGS.put(cacheKey, JSON.stringify(hook));
  return hook;
}

/** Webhookとして本人風に投稿 */
export async function executeWebhook(
  env: Env,
  hook: Webhook,
  channelId: string,
  opts: { content: string; username: string; avatarUrl: string },
): Promise<boolean> {
  const res = await fetch(`${API}/webhooks/${hook.id}/${hook.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: opts.content,
      username: sanitizeUsername(opts.username),
      avatar_url: opts.avatarUrl,
      // 再投稿でメンションを二重に飛ばさない
      allowed_mentions: { parse: [] },
    }),
  });
  if (res.status === 404) {
    // Webhookが削除されていたらキャッシュを破棄(次回作り直し)
    await env.SETTINGS.delete(`webhook:${channelId}`);
  }
  return res.ok;
}

/** ユーザーにDMを送る */
export async function sendDM(
  env: Env,
  userId: string,
  content: string,
): Promise<boolean> {
  const chRes = await rest(env, "POST", "/users/@me/channels", {
    recipient_id: userId,
  });
  if (!chRes.ok) return false;
  const ch = (await chRes.json()) as { id: string };
  const msgRes = await rest(env, "POST", `/channels/${ch.id}/messages`, {
    content,
  });
  return msgRes.ok;
}

function sanitizeUsername(name: string): string {
  // Discordの禁止語("discord"を含む名前など)と長さ制限に対応
  const cleaned = name.replace(/discord/gi, "d1scord").replace(/clyde/gi, "clyd3");
  return cleaned.slice(0, 80) || "user";
}
