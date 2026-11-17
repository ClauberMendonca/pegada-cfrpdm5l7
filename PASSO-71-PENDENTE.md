# PASSO 71 — Entrega 1 (numeracao-permanente-backend): PENDENTE DE APLICAÇÃO

Estado registrado em 2026-11-17. Este arquivo documenta por que a entrega 1
ainda NÃO foi aplicada à base compartilhada. Ele não substitui o anexo.

## Motivo do bloqueio

A tarefa de aplicação exige seguir "o conteúdo exato" do anexo
`passo-71-numeracao-permanente-backend-skip-e1528.txt`. Esse anexo não chegou
à rodada de aplicação (a mensagem veio sem anexos) e a migration da entrega 1
não existe na árvore do projeto.

Verificado antes de parar:

- `pocketbase/migrations/` contém apenas 0001–0008, todas já aplicadas.
  O próximo número livre é **0009** — não há migration pendente da entrega.
- `src/lib/pocketbase/schema.json` e `db_show_schema` (base viva) não possuem
  nenhum campo de numeração nem coleção de contadores em `projects`, `actions`,
  `captures`, `progress_logs`, `time_entries`, `users` ou `ai_requests`.
- Grep no projeto inteiro não encontra "numeracao", "contador", "passo-71" etc.
- Premissa de versão da tarefa (v0.0.58) não se confirma: a árvore corrente
  está em `caa29a0`.

A própria tarefa determina: "Se a aplicação da migration falhar por motivo
específico ... reportar o motivo exato e parar — não improvisar alternativa."
Criar schema de numeração por dedução (formato do número, coleções afetadas,
coleção de contadores, critério do backfill) e aplicá-lo à base com dados
reais do dono seria improvisação proibida, com efeito potencialmente
irreversível (backfill grava valores permanentes).

## Estado da base (inalterado, seguro)

- Nenhum dado tocado; nenhuma migration aplicada nesta rodada.
- IA desligada (`MANUS_AI_ENABLED=0`), nenhum chamado Manus.
- Nada publicado.
- Backup do dono no painel do Skip Cloud: confirmado pelo dono — pode ser
  reaproveitado quando a aplicação ocorrer, se ele assim preferir.

## Como destravar (executar na próxima rodada)

1. Obter o anexo `passo-71-numeracao-permanente-backend-skip-e1528.txt`
   (reenviar anexo ou colar a especificação: campo(s) de número, coleções
   afetadas, formato do número, coleção de contadores se houver, critério
   exato do backfill).
2. Escrever `pocketbase/migrations/0009_*` seguindo o anexo, idempotente
   (no-op em base vazia; não reescrever valores já corretos).
3. `apply_migrations` para validar cedo; conferir com `db_show_schema` e
   `db_query` que o backfill não duplicou/sobrescreveu valores e que os
   demais fluxos (capturas, projetos, ações, progresso, preferências) ficaram
   intactos.
4. `run_qa` (setup/lint/typecheck/build) e commit. Não publicar.
   Não alterar secrets.
