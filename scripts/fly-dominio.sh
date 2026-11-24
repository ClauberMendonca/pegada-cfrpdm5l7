#!/usr/bin/env bash
# Prepara o endereço próprio do Pegada no Fly.io e mostra o que copiar no DNS.
# Uso: scripts/fly-dominio.sh fly.toml usepegada.com.br www.usepegada.com.br
# Precisa de FLY_API_TOKEN. Pode rodar quantas vezes for preciso: só cria o que falta.
# Não publica nada: se o app ainda não existe, ele é criado vazio.
set -euo pipefail

CONFIG="${1:?informe o fly.toml}"
shift
APP=$(grep -E '^app = ' "$CONFIG" | sed -E 's/app = "(.*)"/\1/')

if ! flyctl status --app "$APP" >/dev/null 2>&1; then
  echo "Criando o app $APP (vazio, sem publicar)"
  flyctl apps create "$APP" --org personal
fi

IPS=$(flyctl ips list --app "$APP" --json)
# Endereço IPv4 compartilhado (sem custo) e IPv6 próprio (sem custo).
echo "$IPS" | grep -q '"Type": *"\(shared_v4\|v4\)"' || flyctl ips allocate-v4 --shared --app "$APP"
echo "$IPS" | grep -q '"Type": *"v6"' || flyctl ips allocate-v6 --app "$APP"

echo "=== Endereços do app $APP ==="
flyctl ips list --app "$APP"

for DOMINIO in "$@"; do
  flyctl certs show "$DOMINIO" --app "$APP" >/dev/null 2>&1 || flyctl certs add "$DOMINIO" --app "$APP" || true
  echo "=== Certificado de $DOMINIO ==="
  flyctl certs show "$DOMINIO" --app "$APP" || true
done
