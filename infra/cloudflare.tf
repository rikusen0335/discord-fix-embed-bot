resource "cloudflare_workers_kv_namespace" "settings" {
  account_id = var.cloudflare_account_id
  title      = "fixembed-settings"
}

# Workerスクリプト本体は wrangler deploy でCDする(コードとインフラの分担)。
# KV namespace ID を wrangler.toml / CI に渡すための出力:
output "kv_namespace_id" {
  value = cloudflare_workers_kv_namespace.settings.id
}

output "koyeb_app" {
  value = koyeb_app.fixembed.name
}
