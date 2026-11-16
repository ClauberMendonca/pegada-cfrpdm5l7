// FATIA — REGISTRO DE TEMPO V1: coleção `time_entries` (períodos de dedicação).
//
// Migration NOVA e ADITIVA: cria apenas esta coleção e seus índices. Não
// altera coleções existentes (0001–0005, seeds, regras), nem a coleção de
// autenticação.
//
// Modelo (especificação §6): cada período correndo vira registro ENCERRADO ao
// pausar; retomar abre OUTRO período no mesmo alvo. Registro manual é um
// período fechado com dia+duração e origem explícita. Sem eventos ou sessões
// aninhadas; sem estimativas, faturamento, metas, agenda ou telemetria.
//
// Campos:
// - user_id: dono derivado da sessão (e.auth.id) — nunca do payload do cliente.
// - target_type: 'action' | 'project'.
// - action_id / project_id: atribuição vigente NO MOMENTO do registro
//   (histórica — preservada mesmo que o alvo mude de projeto/título depois).
//   Ação vinculada: servidor deriva project_id/context do vínculo real.
//   Ação avulsa: project_id vazio. Dedicação direta: action_id vazio.
// - context: par semântico preservado para histórico (vida | trabalho).
// - started_at / ended_at: instantes UTC do servidor (date). Registro manual
//   NÃO inventa horário: started_at vazio, dia+duration preenchidos.
// - duration_seconds: duração derivada dos instantes persistidos (cronômetro)
//   OU informada explicitamente (manual). NUNCA de ticks de setInterval.
// - entry_date: dia-calendário no fuso do dono (text 'YYYY-MM-DD').
// - origin: 'timer' | 'manual'.
// - note: nota opcional.
// - status: 'running' (apenas UM por dono — índice único parcial) |
//   'paused' (pausa não soma minutos; retomar abre novo período) | 'ended'.
// - correction_of: id do registro que este corrige (rastreio mínimo da
//   correção — não é auditoria geral).
// - is_deleted / deleted_at / delete_reason: anulação LÓGICA (nunca apagar
//   fisicamente tempo como efeito de concluir/arquivar).
// - previous_*: valores mínimos ANTERIORES preservados para conferir uma
//   correção (dia, duração, nota do valor corrigido).
// - op_id: identidade estável por operação (idempotência server-side) —
//   repetir a mesma intenção (start/stop/manual) não cria entrada duplicada
//   nem conta duas vezes (índice único parcial em op_id por dono).

migrate(
  (app) => {
    const locked = null // escrita exclusiva via hooks autenticados (superuser)

    const collection = new Collection({
      name: 'time_entries',
      type: 'base',
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
        {
          name: 'target_type',
          type: 'select',
          required: true,
          values: ['action', 'project'],
          maxSelect: 1,
        },
        {
          name: 'action_id',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('actions').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'project_id',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('projects').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'context',
          type: 'select',
          required: true,
          values: ['vida', 'trabalho'],
          maxSelect: 1,
        },
        { name: 'started_at', type: 'date' },
        { name: 'ended_at', type: 'date' },
        { name: 'duration_seconds', type: 'number', required: true },
        { name: 'entry_date', type: 'text', required: true },
        {
          name: 'origin',
          type: 'select',
          required: true,
          values: ['timer', 'manual'],
          maxSelect: 1,
        },
        { name: 'note', type: 'text' },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['running', 'paused', 'ended'],
          maxSelect: 1,
        },
        { name: 'correction_of', type: 'text' },
        { name: 'is_deleted', type: 'bool' },
        { name: 'deleted_at', type: 'date' },
        { name: 'delete_reason', type: 'text' },
        { name: 'previous_date', type: 'text' },
        { name: 'previous_duration_seconds', type: 'number' },
        { name: 'previous_note', type: 'text' },
        { name: 'op_id', type: 'text', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        // UNO por dono: apenas UM intervalo correndo (proteção persistente,
        // não só botão desabilitado / localStorage).
        "CREATE UNIQUE INDEX idx_time_running ON time_entries (user_id) WHERE status = 'running'",
        // idempotência: mesma identidade de operação não cria entrada dupla.
        'CREATE UNIQUE INDEX idx_time_op ON time_entries (user_id, op_id) WHERE is_deleted = false',
        // totais e histórico por alvo (uma chamada, sem N chamadas por linha).
        'CREATE INDEX idx_time_action ON time_entries (user_id, action_id)',
        'CREATE INDEX idx_time_project ON time_entries (user_id, project_id)',
        'CREATE INDEX idx_time_date ON time_entries (user_id, entry_date)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('time_entries'))
    } catch (_) {}
  },
)
