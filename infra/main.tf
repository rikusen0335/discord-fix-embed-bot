terraform {
  required_version = ">= 1.6"

  required_providers {
    koyeb = {
      source  = "koyeb/koyeb"
      version = "~> 0.1"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # 必要に応じてリモートステート(Terraform Cloud / R2 など)に変更
  # backend "remote" { ... }
}

# KOYEB_TOKEN 環境変数で認証
provider "koyeb" {}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
