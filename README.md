# Pegada

Método de execução de vida e trabalho: cada passo do dia ligado ao resultado escolhido e ao propósito.

- **Telas:** React 19, TypeScript, Vite, Tailwind e shadcn/ui (`src/`).
- **Servidor:** PocketBase 0.28.4, com as regras do método em JavaScript (`pocketbase/hooks/`) e o esquema em migrations (`pocketbase/migrations/`).
- **Uma API para tudo:** as telas (nível 0), a IA embutida (nível 1) e os agentes por MCP (nível 2) usam as mesmas operações em `/backend/v1/pegada/`.
- **Hospedagem:** um único servidor no Fly.io serve a API e as telas. Há dois apps: o publicado (`fly.toml`) e a prévia, com base própria (`fly.previa.toml`).

## Rodar no computador

```bash
pnpm install
pnpm build
# baixe o PocketBase 0.28.4 em https://github.com/pocketbase/pocketbase/releases
./pocketbase migrate up --dir=pb_data --migrationsDir=pocketbase/migrations
./pocketbase superuser upsert voce@exemplo.com SUA-SENHA --dir=pb_data
./pocketbase serve --dir=pb_data --hooksDir=pocketbase/hooks \
  --migrationsDir=pocketbase/migrations --publicDir=dist
```

Abra http://127.0.0.1:8090 para o app e http://127.0.0.1:8090/_/ para o painel. O cadastro público é fechado: o dono é criado pelo painel, na coleção `users`.

Para mexer só nas telas com recarga automática, rode `pnpm dev` com `VITE_POCKETBASE_URL=http://127.0.0.1:8090` num arquivo `.env.local`.

## Testes

```bash
node scripts/simulador-anthropic.mjs &   # IA simulada, sem custo
ANTHROPIC_API_KEY=teste PEGADA_IA_URL=http://127.0.0.1:8787 ./pocketbase serve ...   # como acima
PEGADA_URL=http://127.0.0.1:8090 PEGADA_TESTE_IA=simulada \
  PB_ADMIN_EMAIL=voce@exemplo.com PB_ADMIN_SENHA=SUA-SENHA pnpm test
```

`scripts/teste-api.mjs` percorre o método inteiro pela API: propósito, responsabilidade, resultado, estratégia, os tipos de avanço e a regra do rastro, capturas, fio de hoje, mapa, histórico e desfazer, lote, IA embutida, agentes por MCP e o isolamento entre donos. Ele cria registros de teste: nunca rode contra o app publicado.

O GitHub roda os mesmos testes em cada pull request (`.github/workflows/testes.yml`).

## IA embutida (nível 1)

A rota `POST /backend/v1/pegada/ia/sugerir` chama o Claude pela API da Anthropic e só sugere, nunca grava. Segredos do servidor:

| Segredo | Para quê |
| --- | --- |
| `ANTHROPIC_API_KEY` | Liga a IA embutida. Sem ela, a rota responde 503 e o app segue sem sugestões. |
| `PEGADA_IA_MODELO` | Opcional. Padrão `claude-sonnet-5-5`. |
| `PEGADA_IA_URL` | Só para testes, aponta para o simulador. |

## Publicar

Uma vez, no Fly.io (com `flyctl` instalado e logado):

```bash
fly apps create pegada-cfrpdm5l7 && fly apps create pegada-cfrpdm5l7-previa
fly volumes create pegada_dados --app pegada-cfrpdm5l7 --region gru --size 1
fly volumes create pegada_previa_dados --app pegada-cfrpdm5l7-previa --region gru --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-... --app pegada-cfrpdm5l7
fly secrets set ANTHROPIC_API_KEY=sk-ant-... --app pegada-cfrpdm5l7-previa
fly deploy --config fly.toml && fly deploy --config fly.previa.toml
fly ssh console --app pegada-cfrpdm5l7 -C "/pb/pocketbase superuser upsert voce@exemplo.com SUA-SENHA --dir=/pb_data"
```

No GitHub: crie o segredo `FLY_API_TOKEN` (`fly tokens create deploy`) e os ambientes `previa` e `producao`, este com o dono como aprovador obrigatório.

Depois disso (`.github/workflows/publicar.yml`):

- cada mudança que entra no `main`, com os testes verdes, vai sozinha para a prévia;
- o app publicado só muda quando alguém roda o fluxo **publicar** com `alvo: publicado` e o dono aprova.

## Cópias de segurança

Há duas camadas:

- **Semanal, dentro do app.** Todo domingo às 03:00 de Brasília o servidor gera uma cópia completa e guarda as 8 mais recentes (migration `0021`). Para baixar uma: abra `https://<endereço do app>/_/`, entre com o e-mail e a senha do dono, vá em Settings → Backups e clique no ícone de download. No mesmo lugar dá para criar uma cópia na hora e restaurar.
- **Diária, do Fly.io.** O Fly tira uma cópia do volume todo dia (`fly volumes snapshots list`); o volume do app oficial é criado guardando 30 dias.

As cópias não vão para o GitHub de propósito: o repositório é público. Vale baixar uma cópia de vez em quando e guardar fora do Fly.io.
