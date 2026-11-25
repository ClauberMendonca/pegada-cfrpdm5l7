#!/usr/bin/env bash
# Publica o Pegada no Fly.io, criando o app e o volume na primeira vez.
# Uso: scripts/fly-publicar.sh fly.previa.toml   (ou fly.toml)
# Precisa de FLY_API_TOKEN. Opcional: PEGADA_DONO_EMAIL e PEGADA_DONO_SENHA para
# criar (ou atualizar) o superusuário e o dono do app logo após publicar;
# ANTHROPIC_API_KEY para ligar a IA embutida; PEGADA_PAINEL_SENHA para o painel
# ter senha própria; PEGADA_SMTP_* e PEGADA_EMAIL_REMETENTE para enviar e-mails;
# PEGADA_URL para o endereço público (padrão: https://<app>.fly.dev).
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
  flyctl volumes create "$VOLUME" --app "$APP" --region "$REGIAO" --size 1 --snapshot-retention 30 --yes
fi

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Guardando a chave da IA embutida no Fly.io"
  flyctl secrets set ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" --app "$APP" --stage >/dev/null
fi

# Endereço público usado nos links dos e-mails (convite, nova senha).
flyctl secrets set PEGADA_URL="${PEGADA_URL:-https://$APP.fly.dev}" --app "$APP" --stage >/dev/null

# Serviço de e-mail: só liga quando os segredos existem.
if [ -n "${PEGADA_SMTP_HOST:-}" ]; then
  echo "Guardando o serviço de e-mail no Fly.io"
  flyctl secrets set \
    PEGADA_SMTP_HOST="$PEGADA_SMTP_HOST" \
    PEGADA_SMTP_PORT="${PEGADA_SMTP_PORT:-587}" \
    PEGADA_SMTP_USER="${PEGADA_SMTP_USER:-}" \
    PEGADA_SMTP_PASS="${PEGADA_SMTP_PASS:-}" \
    PEGADA_EMAIL_REMETENTE="${PEGADA_EMAIL_REMETENTE:-}" \
    --app "$APP" --stage >/dev/null
fi

flyctl deploy --remote-only --config "$CONFIG" --app "$APP"

URL="https://$APP.fly.dev"
for i in $(seq 1 30); do curl -sf "$URL/api/health" >/dev/null && break; sleep 2; done
curl -sf "$URL/api/health" >/dev/null || { echo "O app não respondeu em $URL"; exit 1; }
echo "No ar: $URL"

if [ -n "${PEGADA_DONO_EMAIL:-}" ] && [ -n "${PEGADA_DONO_SENHA:-}" ]; then
  echo "Garantindo o superusuário e o dono"
  # O painel pode ter senha própria (PEGADA_PAINEL_SENHA), diferente da senha do app.
  flyctl ssh console --app "$APP" -C "/pb/pocketbase superuser upsert '$PEGADA_DONO_EMAIL' '${PEGADA_PAINEL_SENHA:-$PEGADA_DONO_SENHA}' --dir=/pb_data" >/dev/null
  node scripts/garantir-dono.mjs "$URL"
fi
