resource "koyeb_app" "fixembed" {
  name = "fixembed"
}

resource "koyeb_service" "gateway" {
  app_name = koyeb_app.fixembed.name

  definition {
    name = "gateway"

    instance_types {
      type = "free"
    }

    scalings {
      min = 1
      max = 1
    }

    regions = ["was"] # Washington DC (freeインスタンス対応リージョン)

    git {
      repository = "github.com/${var.github_repository}"
      branch     = var.github_branch

      docker {
        dockerfile = "apps/gateway/Dockerfile"
      }
    }

    ports {
      port     = 8000
      protocol = "http"
    }

    # Gatewayは外部公開不要だが、freeインスタンスはWebサービス型のため
    # ヘルスチェック用にHTTPを公開する
    routes {
      path = "/"
      port = 8000
    }

    health_checks {
      http {
        port = 8000
        path = "/"
      }
    }

    env {
      key   = "DISCORD_TOKEN"
      value = var.discord_token
    }
    env {
      key   = "WORKER_URL"
      value = var.worker_url
    }
    env {
      key   = "GATEWAY_SHARED_SECRET"
      value = var.gateway_shared_secret
    }
    env {
      key   = "PORT"
      value = "8000"
    }
  }

  depends_on = [koyeb_app.fixembed]
}
