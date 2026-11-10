// FATIA M1A — Base Manus no backend, DESLIGADA por padrão.
//
// Cria a coleção `ai_requests`: registro LOCAL da intenção de uma interação
// com a IA (Manus API v2), persistido ANTES de qualquer chamada externa —
// nunca o resultado dela. Escrita exclusiva de hooks autenticados:
//
// - CRUD direto (create/update/delete) bloqueado: regras `null` (superusuário
//   apenas). A leitura (list/view) fica restrita ao DONO do registro:
//   user_id = @request.auth.id.
// - Nenhum grant owner-editable: o cliente nunca define user_id, task_id,
//   state, result, origin ou local_request_id via API comum — o hook sempre
//   reescreve/valida esses campos server-side a partir da sessão.
// - A alteração da coleção `users`, das regras existentes de outros objetos ou
//   de cadastro NÃO acontece aqui (nada do P0 muda nesta fatia).
//
// Restrições duráveis desta instância (pré-v0.23): sem modificador :changed —
// onde seria necessário, usa-se o fallback (:isset = false || body = campo).

migrate(
  (app) => {
    const locked = null // superusuário apenas (painel admin / hooks)

    const collection = new Collection({
      name: 'ai_requests',
      type: 'base',
      // CRUD direto do app: bloqueado. Hooks autenticados (superuser) são os
      // únicos escritores.
      listRule: "@request.auth.id != '' && user_id = @request.auth.id",
      viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
      createRule: locked,
      updateRule: locked,
      deleteRule: locked,
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        // ---------- origem ----------
        { name: 'origin_type', type: 'text', required: true }, // 'captura'
        { name: 'origin_id', type: 'text', required: true },
        // revisão da origem: raw_text + updated da captura no instante do
        // pedido — se a origem mudar, a intenção local fica datada.
        { name: 'origin_revision', type: 'text', required: true },
        // 'vida' | 'trabalho' — escolha EXPLÍCITA do dono (captura não tem
        // campo context; o hook nunca infere).
        {
          name: 'context',
          type: 'select',
          required: true,
          values: ['vida', 'trabalho'],
          maxSelect: 1,
        },
        // ---------- idempotência ----------
        { name: 'local_request_id', type: 'text', required: true },
        { name: 'remote_task_id', type: 'text' }, // preenchido só pelo hook
        { name: 'remote_request_id', type: 'text' }, // request_id só se realmente recebido
        { name: 'task_url', type: 'text' },
        // ---------- contrato ----------
        { name: 'schema_version', type: 'text', required: true }, // '2026-11-10'
        { name: 'prompt_revision', type: 'text', required: true }, // 'm1a-1'
        {
          name: 'state',
          type: 'select',
          required: true,
          values: [
            'registrado', // intenção local gravada, nenhum POST remoto feito ainda
            'criacao_incerta', // POST saiu, confirmação perdida (sem retry cego)
            'aguardando_pergunta', // Manus esperando resposta do dono
            'decisao_externa', // espera não suportada: decisão humana fora do app
            'em_execucao', // task rodando (sem pergunta pendente)
            'pronta', // resultado estruturado success:true extraído
            'falha', // erro irrecuperável validado server-side
          ],
          maxSelect: 1,
        },
        // question do Manus (task.ask) — preenchido só pelo hook
        { name: 'question', type: 'json' },
        // resultado estruturado validado server-side (schema_version) — só o hook
        { name: 'result', type: 'json' },
        { name: 'last_polled_at', type: 'date' },
        // erro sanitizado (nunca ecoar headers/corpo com credenciais)
        { name: 'error', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        // dedup local: UMA intenção por (dono, local_request_id) — a unicidade
        // nativa protege a concorrência local.
        'CREATE UNIQUE INDEX idx_ai_requests_local ON ai_requests (user_id, local_request_id)',
        'CREATE INDEX idx_ai_requests_user ON ai_requests (user_id)',
        'CREATE INDEX idx_ai_requests_state ON ai_requests (user_id, state)',
        'CREATE INDEX idx_ai_requests_origin ON ai_requests (user_id, origin_type, origin_id)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('ai_requests'))
    } catch (_) {}
  },
)
