import {
  GuildSettings,
  Session,
  TWITTER_HOSTS,
  INSTAGRAM_HOSTS,
} from "./types";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - FixEmbed</title>
<style>
  :root{color-scheme:dark}
  body{font-family:system-ui,sans-serif;background:#1e1f22;color:#dbdee1;max-width:640px;margin:2rem auto;padding:0 1rem}
  a{color:#00a8fc}
  .card{background:#2b2d31;border-radius:8px;padding:1rem 1.25rem;margin:.75rem 0}
  .btn{display:inline-block;background:#5865f2;color:#fff;border:none;border-radius:4px;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer;text-decoration:none}
  select,input[type=checkbox]{font-size:1rem;padding:.35rem;border-radius:4px;background:#1e1f22;color:#dbdee1;border:1px solid #4e5058}
  label{display:block;margin:.9rem 0 .3rem;font-weight:600}
  .muted{color:#949ba4;font-size:.85rem}
  .ok{color:#23a559}
</style>
</head><body>
<h1 style="font-size:1.4rem">🔧 FixEmbed</h1>
${body}
</body></html>`;
}

export function loginPage(): string {
  return layout(
    "ログイン",
    `<div class="card">
      <p>Twitter/X・InstagramのリンクをDiscordで再生可能なEmbedに置き換えるBotの設定ダッシュボードです。</p>
      <a class="btn" href="/login">Discordでログイン</a>
    </div>`,
  );
}

export function guildListPage(
  session: Session,
  botGuildIds: Set<string>,
  clientId: string,
): string {
  const manageable = session.guilds;
  const items = manageable
    .map((g) => {
      const inGuild = botGuildIds.has(g.id);
      return `<div class="card">
        <strong>${esc(g.name)}</strong><br>
        ${
          inGuild
            ? `<a href="/guilds/${g.id}">設定を開く</a>`
            : `<a href="https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=536879104&guild_id=${g.id}">Botを招待する</a> <span class="muted">(未参加)</span>`
        }
      </div>`;
    })
    .join("");
  return layout(
    "サーバー選択",
    `<p>こんにちは、<strong>${esc(session.username)}</strong> さん <span class="muted">(<a href="/logout">ログアウト</a>)</span></p>
     <p class="muted">「サーバー管理」権限を持つサーバーのみ表示されます。</p>
     ${items || `<div class="card">管理できるサーバーがありません。</div>`}`,
  );
}

export function guildSettingsPage(
  guildName: string,
  guildId: string,
  s: GuildSettings,
  csrf: string,
  saved: boolean,
): string {
  const options = (hosts: readonly string[], selected: string) =>
    hosts
      .map(
        (h) =>
          `<option value="${h}"${h === selected ? " selected" : ""}>${h}</option>`,
      )
      .join("");
  return layout(
    guildName,
    `<p><a href="/">&larr; サーバー一覧</a></p>
    <h2 style="font-size:1.15rem">${esc(guildName)}</h2>
    ${saved ? `<p class="ok">✓ 保存しました</p>` : ""}
    <form method="post" action="/guilds/${guildId}" class="card">
      <input type="hidden" name="csrf" value="${csrf}">
      <label><input type="checkbox" name="enabled"${s.enabled ? " checked" : ""}> 有効にする</label>
      <label for="tw">Twitter/X の置換先</label>
      <select id="tw" name="twitterHost">${options(TWITTER_HOSTS, s.twitterHost)}</select>
      <label for="ig">Instagram の置換先</label>
      <select id="ig" name="instagramHost">${options(INSTAGRAM_HOSTS, s.instagramHost)}</select>
      <p><button class="btn" type="submit">保存</button></p>
    </form>
    <p class="muted">置換先サービスが不調な場合はここで切り替えてください。</p>`,
  );
}
