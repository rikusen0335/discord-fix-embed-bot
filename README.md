# FixEmbed — Discord Embed修正Bot

twitter.com / x.com / instagram.com のリンクを、動画をその場で再生できるEmbed
(fxtwitter / InstaFix 系サービス)に置き換え、**元の投稿者本人が貼ったように**
Webhookで再投稿するBotです。リンクを開くとiPhone等では公式アプリにリダイレクト
されます(置換先サービスが人間のブラウザを元URLへ302させるため)。

## アーキテクチャ

```
Discord Gateway ←WS── apps/gateway (Koyeb free, Node.js/discord.js)
                          │ 対象リンク検知 → HMAC署名付きHTTP
                          ▼
                 apps/worker (Cloudflare Workers + Hono)
                   ├ URL置換 (fxtwitter / kkinstagram 等, ギルドごとにKV設定)
                   ├ 元メッセージ削除 + Webhookで本人風に再投稿
                   └ ダッシュボード (Discord OAuthログイン, 置換先の切替UI)
                          │
                 Cloudflare KV (設定 / Webhookキャッシュ / セッション)
```

インフラは `infra/` の Terraform で管理(Koyebアプリ + Cloudflare KV)。
WorkerコードのCDは GitHub Actions + wrangler、GatewayのCDは Koyeb の
git連携autodeployで行います。

## セットアップ手順

### 1. Discordアプリケーション作成

1. https://discord.com/developers/applications で New Application
2. **Bot** タブ: トークンを控える。**Message Content Intent を有効化**
3. **OAuth2** タブ: Client Secret を控え、Redirect に
   `https://<worker-url>/callback` を追加(URLはデプロイ後に確定)
4. Bot招待URL(ダッシュボードにも表示されます):
   `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot&permissions=536879104`
   (必要権限: View Channels / Manage Messages / Manage Webhooks)

### 2. Terraformでインフラ作成

```bash
cd infra
export KOYEB_TOKEN=...          # https://app.koyeb.com/settings/api
terraform init
terraform apply \
  -var cloudflare_api_token=... \
  -var cloudflare_account_id=... \
  -var github_repository=<owner>/<repo> \
  -var discord_token=... \
  -var gateway_shared_secret=$(openssl rand -hex 32) \
  -var worker_url=https://fixembed-worker.<subdomain>.workers.dev
terraform output kv_namespace_id   # ← 次のステップで使用
```

初回はKoyebのGitHub連携(App Install)を https://app.koyeb.com で先に済ませてください。

### 3. Worker初回デプロイ

```bash
cd apps/worker
# wrangler.toml の REPLACE_WITH_KV_NAMESPACE_ID / REPLACE_WITH_APPLICATION_ID を書き換え
wrangler secret put BOT_TOKEN
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put GATEWAY_SHARED_SECRET   # terraformに渡したのと同じ値
wrangler deploy
```

デプロイ後のWorker URLをDiscordのOAuth Redirectと`worker_url`変数に反映。

### 4. CD用のGitHub Secrets

| Secret | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers編集権限のCloudflareトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `CF_KV_NAMESPACE_ID` | `terraform output kv_namespace_id` |
| `DISCORD_CLIENT_ID` | DiscordアプリのApplication ID |
| `DISCORD_BOT_TOKEN` | Botトークン |
| `DISCORD_CLIENT_SECRET` | OAuth Client Secret |
| `GATEWAY_SHARED_SECRET` | HMAC共有シークレット |
| `KOYEB_TOKEN` | Koyeb APIトークン(terraformジョブ用) |
| `WORKER_URL` | Worker URL(terraformジョブ用) |

以後は `main` への push で Worker が自動デプロイされ、Gateway は Koyeb が
自動ビルド&再デプロイします。

## ダッシュボード

Worker URLをブラウザで開く → Discordでログイン → 「サーバー管理」権限のある
サーバーごとに、機能のON/OFFと置換先サービス
(fxtwitter / fixupx / vxtwitter / fixvx、kkinstagram / ddinstagram / instagramez)
を切り替えられます。設定はCloudflare KVに保存され即時反映されます。

## 制約・注意

- Webhook再投稿のため、名前の横に「APP」タグが付きます(Discordの仕様)
- 再投稿メッセージへの返信通知は元の投稿者に届きません
- Botに `Manage Messages` / `Manage Webhooks` 権限がないチャンネルでは何もしません
- Koyeb freeインスタンスは1つまで。Cloudflare側は無料枠(Workers 10万req/日, KV)で十分動作します
- 置換先は外部の無料サービスです。不調時はダッシュボードで切り替えてください
