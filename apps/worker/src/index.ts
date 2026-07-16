import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  Env,
  MessageEvent,
  GuildSettings,
  DEFAULT_SETTINGS,
  TWITTER_HOSTS,
  INSTAGRAM_HOSTS,
  Session,
} from "./types";
import { processMessageEvent } from "./process";
import { verifyInteraction } from "./interactions";
import { loginPage, guildListPage, guildSettingsPage } from "./html";

export { GatewayDO } from "./gateway";

const app = new Hono<{ Bindings: Env; Variables: { session: Session; sessionId: string } }>();

/* ---------------- HMAC 検証 (Gateway -> Worker) ---------------- */

async function verifyHmac(env: Env, req: Request, body: string): Promise<boolean> {
  const sig = req.headers.get("x-signature");
  const ts = req.headers.get("x-timestamp");
  if (!sig || !ts) return false;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GATEWAY_SHARED_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ts}.${body}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // timing-safe 比較
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

app.use("/api/*", async (c, next) => {
  const body = await c.req.raw.clone().text();
  if (!(await verifyHmac(c.env, c.req.raw, body))) {
    return c.text("unauthorized", 401);
  }
  await next();
});

/* ---------------- Gateway からのイベント ---------------- */

// (外部Gateway用の互換エンドポイント。DO常駐版では通常使われない)
app.post("/api/event", async (c) => {
  const ev = await c.req.json<MessageEvent>();
  const result = await processMessageEvent(c.env, ev);
  return c.json(result, result.error ? 500 : 200);
});

app.post("/api/guilds/sync", async (c) => {
  const { guilds } = await c.req.json<{ guilds: { id: string; name: string }[] }>();
  await Promise.all(
    guilds.map((g) => c.env.SETTINGS.put(`guild:${g.id}`, JSON.stringify(g))),
  );
  return c.json({ ok: true });
});

app.post("/api/guilds/remove", async (c) => {
  const { id } = await c.req.json<{ id: string }>();
  await c.env.SETTINGS.delete(`guild:${id}`);
  return c.json({ ok: true });
});

/* ---------------- Discord OAuth ---------------- */

const OAUTH_SCOPE = "identify guilds";
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

function redirectUri(c: { req: { url: string } }): string {
  const u = new URL(c.req.url);
  return `${u.origin}/callback`;
}

app.get("/login", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(c),
    scope: OAUTH_SCOPE,
    state,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state || state !== getCookie(c, "oauth_state")) {
    return c.text("invalid oauth state", 400);
  }
  deleteCookie(c, "oauth_state", { path: "/" });

  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(c),
    }),
  });
  if (!tokenRes.ok) return c.text("token exchange failed", 502);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const auth = { headers: { authorization: `Bearer ${access_token}` } };
  const [userRes, guildsRes] = await Promise.all([
    fetch("https://discord.com/api/v10/users/@me", auth),
    fetch("https://discord.com/api/v10/users/@me/guilds", auth),
  ]);
  if (!userRes.ok || !guildsRes.ok) return c.text("discord api error", 502);

  const user = (await userRes.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
  const guilds = (await guildsRes.json()) as {
    id: string;
    name: string;
    permissions: string;
  }[];

  const manageable = guilds
    .filter((g) => {
      const p = BigInt(g.permissions);
      return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
    })
    .map((g) => ({ id: g.id, name: g.name }));

  const session: Session = {
    userId: user.id,
    username: user.global_name ?? user.username,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : null,
    guilds: manageable,
  };

  const sessionId = crypto.randomUUID();
  await c.env.SETTINGS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: 7 * 24 * 3600,
  });
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  return c.redirect("/");
});

app.get("/logout", async (c) => {
  const sid = getCookie(c, "session");
  if (sid) await c.env.SETTINGS.delete(`session:${sid}`);
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

/* ---------------- ダッシュボード ---------------- */

const sessionMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: Session; sessionId: string };
}>(async (c, next) => {
  const sid = getCookie(c, "session");
  const session = sid
    ? await c.env.SETTINGS.get<Session>(`session:${sid}`, "json")
    : null;
  if (session && sid) {
    c.set("session", session);
    c.set("sessionId", sid);
  }
  await next();
});

app.use("/", sessionMiddleware);
app.use("/guilds/*", sessionMiddleware);

app.get("/", async (c) => {
  const session = c.get("session");
  if (!session) return c.html(loginPage());

  // Bot参加済みギルド判定(gatewayが同期したguild:*キー)
  const botGuildIds = new Set<string>();
  await Promise.all(
    session.guilds.map(async (g) => {
      if (await c.env.SETTINGS.get(`guild:${g.id}`)) botGuildIds.add(g.id);
    }),
  );
  return c.html(guildListPage(session, botGuildIds, c.env.DISCORD_CLIENT_ID));
});

async function csrfToken(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`csrf:${sessionId}`),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function canManage(session: Session, guildId: string): boolean {
  return session.guilds.some((g) => g.id === guildId);
}

app.get("/guilds/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/");
  const guildId = c.req.param("id");
  if (!canManage(session, guildId)) return c.text("forbidden", 403);

  const settings =
    (await c.env.SETTINGS.get<GuildSettings>(`settings:${guildId}`, "json")) ??
    DEFAULT_SETTINGS;
  const name =
    session.guilds.find((g) => g.id === guildId)?.name ?? guildId;
  return c.html(
    guildSettingsPage(
      name,
      guildId,
      settings,
      await csrfToken(c.get("sessionId")),
      c.req.query("saved") === "1",
    ),
  );
});

app.post("/guilds/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/");
  const guildId = c.req.param("id");
  if (!canManage(session, guildId)) return c.text("forbidden", 403);

  const form = await c.req.parseBody();
  if (form["csrf"] !== (await csrfToken(c.get("sessionId")))) {
    return c.text("bad csrf token", 403);
  }

  const twitterHost = String(form["twitterHost"] ?? "");
  const instagramHost = String(form["instagramHost"] ?? "");
  const settings: GuildSettings = {
    enabled: form["enabled"] === "on",
    twitterHost: (TWITTER_HOSTS as readonly string[]).includes(twitterHost)
      ? twitterHost
      : DEFAULT_SETTINGS.twitterHost,
    instagramHost: (INSTAGRAM_HOSTS as readonly string[]).includes(instagramHost)
      ? instagramHost
      : DEFAULT_SETTINGS.instagramHost,
  };
  await c.env.SETTINGS.put(`settings:${guildId}`, JSON.stringify(settings));
  return c.redirect(`/guilds/${guildId}?saved=1`);
});

/* ---------------- スラッシュコマンド (Interactions) ---------------- */

app.post("/interactions", async (c) => {
  const body = await c.req.raw.clone().text();
  if (!(await verifyInteraction(c.env, c.req.raw, body))) {
    return c.text("invalid request signature", 401);
  }
  const i = JSON.parse(body) as {
    type: number;
    data?: { name?: string };
    member?: { user?: { id: string } };
    user?: { id: string };
  };
  if (i.type === 1) return c.json({ type: 1 }); // PING

  if (i.type === 2 && i.data?.name === "dashboard") {
    const url = new URL(c.req.url).origin;
    return c.json({
      type: 4,
      data: {
        content: `🔧 FixEmbed 設定ダッシュボード: ${url}`,
        flags: 64, // ephemeral (本人にのみ表示)
      },
    });
  }
  return c.json({ type: 4, data: { content: "unknown command", flags: 64 } });
});

// コマンド登録 (冪等。デプロイ後に一度叩く)
app.get("/setup-commands", async (c) => {
  const res = await fetch(
    `https://discord.com/api/v10/applications/${c.env.DISCORD_CLIENT_ID}/commands`,
    {
      method: "PUT",
      headers: {
        authorization: `Bot ${c.env.BOT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        { name: "dashboard", description: "設定ダッシュボードのURLをDMで受け取る" },
      ]),
    },
  );
  return c.json({ registered: res.ok, status: res.status });
});

// Gateway DO の起動/監視用エンドポイント
app.get("/start", async (c) => {
  const stub = c.env.GATEWAY_DO.get(c.env.GATEWAY_DO.idFromName("main"));
  const res = await stub.fetch("https://do/ensure");
  return c.text(`gateway: ${await res.text()}`);
});

app.get("/status", async (c) => {
  const stub = c.env.GATEWAY_DO.get(c.env.GATEWAY_DO.idFromName("main"));
  const res = await stub.fetch("https://do/status");
  return c.json((await res.json()) as Record<string, unknown>);
});

export default {
  fetch: app.fetch,
  // cronでDOを起こし、接続断からの自動復旧を担保する
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const stub = env.GATEWAY_DO.get(env.GATEWAY_DO.idFromName("main"));
    await stub.fetch("https://do/ensure");
  },
};
