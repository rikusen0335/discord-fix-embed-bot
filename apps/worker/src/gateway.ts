// Discord Gateway クライアント (Durable Object 常駐版)
// discord.js を使わず、生の Gateway プロトコル (v10) を実装する。
import type { Env, MessageEvent } from "./types";
import { processMessageEvent } from "./process";

const GATEWAY_URL = "https://gateway.discord.gg/?v=10&encoding=json";
// GUILDS (1<<0) | GUILD_MESSAGES (1<<9) | MESSAGE_CONTENT (1<<15)
const INTENTS = 1 | 512 | 32768;

const LINK_RE =
  /https?:\/\/(?:www\.)?(?:(?:twitter|x)\.com\/\w+\/status\/\d+|instagram\.com\/(?:p|reel|reels|tv|share)\/[\w-]+)/i;

interface GatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

export class GatewayDO implements DurableObject {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastAck = true;
  private connecting = false;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  // cron / 手動から叩かれる。接続がなければ張り直す。
  async fetch(_req: Request): Promise<Response> {
    await this.ensureConnected();
    const status = this.ws ? "connected" : "connecting";
    await this.state.storage.setAlarm(Date.now() + 60_000);
    return new Response(status);
  }

  // 死活監視: 1分ごとに接続を確認
  async alarm(): Promise<void> {
    await this.ensureConnected();
    await this.state.storage.setAlarm(Date.now() + 60_000);
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws || this.connecting) return;
    this.connecting = true;
    try {
      const url = this.resumeUrl
        ? `${this.resumeUrl.replace(/^wss:/, "https:")}/?v=10&encoding=json`
        : GATEWAY_URL;
      const resp = await fetch(url, { headers: { Upgrade: "websocket" } });
      const ws = resp.webSocket;
      if (!ws) throw new Error(`no websocket in response (${resp.status})`);
      ws.accept();
      this.ws = ws;
      this.lastAck = true;

      ws.addEventListener("message", (ev) => {
        void this.onMessage(String(ev.data));
      });
      ws.addEventListener("close", (ev) => {
        console.log(`gateway closed: ${ev.code} ${ev.reason}`);
        this.cleanup(ev.code);
      });
      ws.addEventListener("error", () => this.cleanup());
    } catch (e) {
      console.error("gateway connect failed:", e);
      this.resumeUrl = null;
    } finally {
      this.connecting = false;
    }
  }

  private cleanup(closeCode?: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.ws = null;
    // 4004(認証失敗)等の致命的コードではセッションを破棄
    if (closeCode && [4004, 4010, 4011, 4012, 4013, 4014].includes(closeCode)) {
      this.sessionId = null;
      this.resumeUrl = null;
      console.error(`fatal gateway close code ${closeCode}; check BOT_TOKEN / intents`);
      return;
    }
    // それ以外は即再接続を試みる
    void this.ensureConnected();
  }

  private send(payload: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(payload));
  }

  private async onMessage(raw: string): Promise<void> {
    let p: GatewayPayload;
    try {
      p = JSON.parse(raw) as GatewayPayload;
    } catch {
      return;
    }
    if (p.s !== null) this.seq = p.s;

    switch (p.op) {
      case 10: {
        // Hello → heartbeat開始 + identify/resume
        const { heartbeat_interval } = p.d as { heartbeat_interval: number };
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (!this.lastAck) {
            // ゾンビ接続 → 張り直し
            console.log("no heartbeat ack; reconnecting");
            try {
              this.ws?.close(4000, "zombie");
            } catch {}
            this.cleanup();
            return;
          }
          this.lastAck = false;
          this.send({ op: 1, d: this.seq });
        }, heartbeat_interval);

        if (this.sessionId && this.seq !== null) {
          this.send({
            op: 6,
            d: { token: this.env.BOT_TOKEN, session_id: this.sessionId, seq: this.seq },
          });
        } else {
          this.send({
            op: 2,
            d: {
              token: this.env.BOT_TOKEN,
              intents: INTENTS,
              properties: { os: "linux", browser: "fixembed", device: "fixembed" },
            },
          });
        }
        break;
      }
      case 11: // Heartbeat ACK
        this.lastAck = true;
        break;
      case 1: // サーバーからのHeartbeat要求
        this.send({ op: 1, d: this.seq });
        break;
      case 7: // Reconnect要求
        try {
          this.ws?.close(4000, "reconnect requested");
        } catch {}
        break;
      case 9: // Invalid Session
        if (!(p.d as boolean)) {
          this.sessionId = null;
          this.resumeUrl = null;
          this.seq = null;
        }
        try {
          this.ws?.close(4000, "invalid session");
        } catch {}
        break;
      case 0:
        await this.onDispatch(p.t as string, p.d);
        break;
    }
  }

  private async onDispatch(t: string, d: unknown): Promise<void> {
    switch (t) {
      case "READY": {
        const data = d as {
          session_id: string;
          resume_gateway_url: string;
          guilds: { id: string }[];
        };
        this.sessionId = data.session_id;
        this.resumeUrl = data.resume_gateway_url;
        console.log(`gateway READY (${data.guilds.length} guilds)`);
        break;
      }
      case "RESUMED":
        console.log("gateway RESUMED");
        break;
      case "GUILD_CREATE": {
        const g = d as { id: string; name?: string };
        await this.env.SETTINGS.put(
          `guild:${g.id}`,
          JSON.stringify({ id: g.id, name: g.name ?? g.id }),
        );
        break;
      }
      case "GUILD_DELETE": {
        const g = d as { id: string; unavailable?: boolean };
        if (!g.unavailable) await this.env.SETTINGS.delete(`guild:${g.id}`);
        break;
      }
      case "MESSAGE_CREATE": {
        const m = d as {
          id: string;
          channel_id: string;
          guild_id?: string;
          content: string;
          author: {
            id: string;
            bot?: boolean;
            username: string;
            global_name: string | null;
            avatar: string | null;
          };
          member?: { nick?: string | null; avatar?: string | null };
          webhook_id?: string;
        };
        if (!m.guild_id || m.author.bot || m.webhook_id) return;
        if (!LINK_RE.test(m.content)) return;

        const avatarUrl = m.member?.avatar
          ? `https://cdn.discordapp.com/guilds/${m.guild_id}/users/${m.author.id}/avatars/${m.member.avatar}.png?size=128`
          : m.author.avatar
            ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(m.author.id) >> 22n) % 6}.png`;

        const ev: MessageEvent = {
          guild_id: m.guild_id,
          channel_id: m.channel_id,
          message_id: m.id,
          content: m.content,
          author: {
            id: m.author.id,
            username: m.author.username,
            global_name: m.author.global_name,
            display_name: m.member?.nick ?? null,
            avatar_url: avatarUrl,
          },
        };
        await processMessageEvent(this.env, ev);
        break;
      }
    }
  }
}
