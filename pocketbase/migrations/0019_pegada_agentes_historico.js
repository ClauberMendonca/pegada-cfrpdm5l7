// PEGADA — AGENTES, HISTÓRICO COM DESFAZER E PROPOSTAS (aditiva, idempotente).
//
// 1. agents — cada agente de IA que opera o app (nível 2) tem acesso próprio,
//    revogável e com escopos. O token só é mostrado uma vez; o banco guarda
//    apenas o hash (sha256) e um prefixo para identificação visual.
// 2. audit_events — histórico de quem fez o quê: pessoa, IA embutida (nível 1)
//    ou agente. Cada evento guarda a lista de mudanças (antes/depois) para
//    permitir desfazer.
// 3. proposals — escolhas do método (Propósito, Responsabilidades, Resultados,
//    Estratégias) feitas por agentes ficam pendentes até o dono confirmar.
//
// Escrita: só pela API do método (hooks). Leitura: só o dono.
migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    const ownerRead = "@request.auth.id != '' && user_id = @request.auth.id"
    const exists = (name) => {
      try {
        app.findCollectionByNameOrId(name)
        return true
      } catch (_) {
        return false
      }
    }

    if (!exists('agents')) {
      const agents = new Collection({
        name: 'agents',
        type: 'base',
        listRule: ownerRead,
        viewRule: ownerRead,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { name: 'name', type: 'text', required: true, max: 120 },
          { name: 'token_hash', type: 'text', required: true, hidden: true },
          { name: 'token_prefix', type: 'text', max: 20 },
          // escopos: ler | capturar | avancos | propor | desfazer
          { name: 'scopes', type: 'json' },
          {
            name: 'status',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['ativo', 'revogado'],
          },
          { name: 'hourly_limit', type: 'number', onlyInt: true, min: 1, max: 100000 },
          { name: 'window_start', type: 'date' },
          { name: 'window_count', type: 'number', onlyInt: true, min: 0 },
          { name: 'last_used_at', type: 'date' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_agents_user ON agents (user_id)',
          'CREATE UNIQUE INDEX idx_agents_token ON agents (token_hash)',
        ],
      })
      app.save(agents)
    }
    const agentsId = app.findCollectionByNameOrId('agents').id

    if (!exists('audit_events')) {
      const audit = new Collection({
        name: 'audit_events',
        type: 'base',
        listRule: ownerRead,
        viewRule: ownerRead,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
            cascadeDelete: true,
          },
          {
            name: 'actor_type',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['pessoa', 'ia_embutida', 'agente'],
          },
          {
            name: 'agent_id',
            type: 'relation',
            collectionId: agentsId,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'op', type: 'text', required: true, max: 80 },
          { name: 'summary', type: 'text', max: 1000 },
          // [{ c: coleção, id, k: 'create'|'update', before: {...}, after: {...} }]
          { name: 'changes', type: 'json' },
          { name: 'batch_id', type: 'text', max: 40 },
          { name: 'proposal_id', type: 'text', max: 40 },
          { name: 'undo_of', type: 'text', max: 40 },
          { name: 'undone_at', type: 'date' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: [
          'CREATE INDEX idx_audit_user_created ON audit_events (user_id, created)',
          'CREATE INDEX idx_audit_batch ON audit_events (batch_id)',
        ],
      })
      app.save(audit)
    }

    if (!exists('proposals')) {
      const proposals = new Collection({
        name: 'proposals',
        type: 'base',
        listRule: ownerRead,
        viewRule: ownerRead,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
            cascadeDelete: true,
          },
          {
            name: 'agent_id',
            type: 'relation',
            collectionId: agentsId,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'op', type: 'text', required: true, max: 80 },
          { name: 'input', type: 'json' },
          { name: 'summary', type: 'text', max: 1000 },
          { name: 'reason', type: 'text', max: 2000 },
          {
            name: 'status',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['pendente', 'confirmada', 'recusada', 'falhou'],
          },
          { name: 'decided_at', type: 'date' },
          { name: 'result_event_id', type: 'text', max: 40 },
          { name: 'error', type: 'text', max: 1000 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_proposals_user_status ON proposals (user_id, status)'],
      })
      app.save(proposals)
    }
  },
  (app) => {
    for (const name of ['proposals', 'audit_events', 'agents']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (_) {}
    }
  },
)
