import { Client, GatewayIntentBits, Events, Message } from "discord.js";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const DISCORD_TOKEN = required("DISCORD_TOKEN");
const WORKER_URL = required("WORKER_URL").replace(/\/$/, "");
const SHARED_SECRET = required("GATEWAY_SHARED_SECRET");
const PORT = Number(process.env.PORT ?? 8000);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// 対象URLの検知(置換自体はWorker側で行う)
const LINK_RE =
  /https?:\/\/(?:www\.)?(?:(?:twitter|x)\.com\/\w+\/status\/\d+|instagram\.com\/(?:p|reel|reels|tv|share)\/[\w-]+)/i;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function post(path: string, body: unknown): Promise<void> {
  const payload = JSON.stringify(body);
  const ts = Date.now().toString();
  const sig = createHmac("sha256", SHARED_SECRET)
    .update(`${ts}.${payload}`)
    .digest("hex");
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": sig,
      "x-timestamp": ts,
    },
    body: payload,
  });
  if (!res.ok) {
    console.error(`worker ${path} -> ${res.status}: ${await res.text()}`);
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag} (${c.guilds.cache.size} guilds)`);
  // ダッシュボードの「Botが参加中か」判定用に全ギルドを登録
  void post("/api/guilds/sync", {
    guilds: c.guilds.cache.map((g) => ({ id: g.id, name: g.name })),
  });
});

client.on(Events.GuildCreate, (g) => {
  void post("/api/guilds/sync", { guilds: [{ id: g.id, name: g.name }] });
});

client.on(Events.GuildDelete, (g) => {
  void post("/api/guilds/remove", { id: g.id });
});

client.on(Events.MessageCreate, (message: Message) => {
  if (message.author.bot || !message.inGuild()) return;
  if (!LINK_RE.test(message.content)) return;

  void post("/api/event", {
    guild_id: message.guildId,
    channel_id: message.channelId,
    message_id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName,
      display_name: message.member?.nickname ?? null,
      avatar_url: (message.member ?? message.author).displayAvatarURL({
        extension: "png",
        size: 128,
      }),
    },
  });
});

// Koyebのヘルスチェック用
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(client.isReady() ? "ok" : "starting");
}).listen(PORT, () => console.log(`health check on :${PORT}`));

client.login(DISCORD_TOKEN);
