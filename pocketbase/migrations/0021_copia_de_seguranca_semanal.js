/// <reference path="../pb_data/types.d.ts" />
// Cópia de segurança automática: todo domingo às 06:00 UTC (03:00 de Brasília)
// o servidor gera uma cópia completa dos dados e guarda as 8 mais recentes.
// Elas ficam em Configurações > Backups do painel do servidor (/_/), de onde
// o dono pode baixar ou restaurar.
migrate(
  (app) => {
    const s = app.settings()
    s.backups.cron = '0 6 * * 0'
    s.backups.cronMaxKeep = 8
    app.save(s)
  },
  (app) => {
    const s = app.settings()
    s.backups.cron = ''
    app.save(s)
  },
)
