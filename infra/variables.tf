variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Workers KV 編集権限を持つ Cloudflare API トークン"
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare アカウントID"
}

variable "github_repository" {
  type        = string
  description = "デプロイ元リポジトリ (例: rikusen0335/discord-fix-embed-bot)"
}

variable "github_branch" {
  type    = string
  default = "main"
}

variable "discord_token" {
  type        = string
  sensitive   = true
  description = "Discord Botトークン"
}

variable "gateway_shared_secret" {
  type        = string
  sensitive   = true
  description = "Gateway と Worker 間の HMAC 共有シークレット"
}

variable "worker_url" {
  type        = string
  description = "Cloudflare Worker の URL (例: https://fixembed-worker.<subdomain>.workers.dev)"
}
