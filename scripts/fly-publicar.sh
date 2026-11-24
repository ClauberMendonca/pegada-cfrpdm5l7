#!/usr/bin/env bash
# Publica o Pegada no Fly.io, criando o app e o volume na primeira vez.
# Uso: scripts/fly-publicar.sh fly.previa.toml   (ou fly.toml)
# Precisa de FLY_API_TOKEN. Opcional: PEGADA_DONO_EMAIL e PEGADA_DONO_SENHA para
# criar (ou atualizar) o superusuário e o dono do app logo após publicar;
# ANTHROPIC_API_KEY para ligar a IA embutida.
set -euo pipefail

CONFIG="${1:?informe o fly.toml}"
APP=$(grep -E '^app = ' "$CONFIG" | sed -E 's/app = "(.*)"/\1/')
REGIAO=$(grep -E '^primary_region = ' "$CONFIG" | sed -E 's/primary_region = "([a-z]+)".*/\1/')
VOLUME=$(grep -E '^\s*source = ' "$CONFIG" | sed -E 's/.*source = "(.*)"/\1/')

echo "App: $APP · região: $REGIAO · volume: $VOLUME"

if ! flyctl status --app "$APP" >/dev/null 2>&1; then
  echo "Criando o app $APP"
  flyctl apps create "$APP" --org personal
fi

if [ "$(flyctl volumes list --app "$APP" --json | grep -c "\"name\": \"$VOLUME\"" || true)" = "0" ]; then
  echo "Criando o volume $VOLUME"
  flyctl volumes create "$VOLUME" --app "$APP" --region "$REGIAO" --size 1 --yes
fi

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Guardando a chave da IA embutida no Fly.io"
  flyctl secrets set ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" --app "$APP" --stage >/dev/null
fi

flyctl deploy --remote-only --config "$CONFIG" --app "$APP"

URL="https://$APP.fly.dev"
for i in $(seq 1 30); do curl -sf "$URL/api/health" >/dev/null && break; sleep 2; done
curl -sf "$URL/api/health" >/dev/null || { echo "O app não respondeu em $URL"; exit 1; }
echo "No ar: $URL"

if [ -n "${PEGADA_DONO_EMAIL:-}" ] && [ -n "${PEGADA_DONO_SENHA:-}" ]; then
  echo "Garantindo o superusuário e o dono"
  flyctl ssh console --app "$APP" -C "/pb/pocketbase superuser upsert '$PEGADA_DONO_EMAIL' '$PEGADA_DONO_SENHA' --dir=/pb_data" >/dev/null
  node scripts/garantir-dono.mjs "$URL"
fi
