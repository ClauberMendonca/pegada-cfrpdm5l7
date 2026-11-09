migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    const ownerEmail = 'cm@biodrinks.com.br'

    let ownerRecord
    try {
      ownerRecord = app.findAuthRecordByEmail('_pb_users_auth_', ownerEmail)
    } catch (_) {
      // Create owner record if not present
      ownerRecord = new Record(users)
      ownerRecord.setEmail(ownerEmail)
      ownerRecord.setPassword('Skip@Pass123')
      ownerRecord.setVerified(true)
      ownerRecord.set('name', 'Dono do Sistema')
      ownerRecord.set('timezone', 'America/Sao_Paulo')
      app.save(ownerRecord)
    }

    const ownerId = ownerRecord.id

    // Let's seed initial starter data demonstrating the Pragmatic Intelligence model:
    // 1. A project separating aspiration from controllable delivery
    const projects = app.findCollectionByNameOrId('projects')
    const actions = app.findCollectionByNameOrId('actions')
    const captures = app.findCollectionByNameOrId('captures')
    const progressLogs = app.findCollectionByNameOrId('progress_logs')

    const existingProject = app.findRecordsByFilter('projects', `user_id = '${ownerId}'`, '', 1, 0)
    if (existingProject.length === 0) {
      const proj1 = new Record(projects)
      proj1.set('user_id', ownerId)
      proj1.set('title', 'Estruturação Operacional da Rotina Semanal')
      proj1.set('context', 'trabalho')
      proj1.set('status', 'ativo')
      proj1.set(
        'aspiration',
        'Ter clareza cirúrgica do que fazer sem estresse ou retrabalho ao longo do trimestre.',
      )
      proj1.set(
        'controllable_delivery',
        'Montar e testar o rito de fechamento e planejamento diário de 15 minutos durante 3 semanas consecutivas.',
      )
      proj1.set(
        'completion_condition',
        'Documento de rito finalizado e 15 dias úteis de execução registrados.',
      )
      proj1.set('deadline', '')
      proj1.set(
        'learning_asset',
        'Checklist de rito diário reutilizável para a equipe ou novos projetos.',
      )
      proj1.set('r_resultado', 'Redução de ruído mental e 100% dos avanços críticos executados.')
      proj1.set('r_razao', 'Evitar reatividade excessiva durante o expediente de alta demanda.')
      proj1.set('r_referencia', 'Inteligência Pragmática — foco estrito na entrega controlável.')
      proj1.set('r_rumo', 'Definir rito -> Praticar 3 semanas -> Consolidar checklist.')
      proj1.set('r_recursos', '15 minutos no início da manhã e no fim do dia.')
      proj1.set('r_restricoes', 'Sem adicionar ferramentas externas complexas.')
      proj1.set('r_riscos', 'Urgências do dia interromperem o rito.')
      proj1.set('r_responsavel', 'Dono único.')
      app.save(proj1)

      // Seed an action for proj1 that is the chosen Next Step for Today
      const act1 = new Record(actions)
      act1.set('user_id', ownerId)
      act1.set('project_id', proj1.id)
      act1.set('title', 'Redigir checklist preliminar do rito de 15 min')
      act1.set('context', 'trabalho')
      act1.set('status', 'pronta')
      act1.set('is_next_step', true)
      act1.set('is_today_selected', true)
      app.save(act1)

      // Another action for proj1
      const act2 = new Record(actions)
      act2.set('user_id', ownerId)
      act2.set('project_id', proj1.id)
      act2.set('title', 'Testar o rito matinal no primeiro dia')
      act2.set('context', 'trabalho')
      act2.set('status', 'pronta')
      act2.set('is_next_step', false)
      act2.set('is_today_selected', true)
      app.save(act2)

      // Project 2: Vida
      const proj2 = new Record(projects)
      proj2.set('user_id', ownerId)
      proj2.set('title', 'Hábito de Leitura Técnica e Reflexão')
      proj2.set('context', 'vida')
      proj2.set('status', 'ativo')
      proj2.set(
        'aspiration',
        'Desenvolver profundidade teórica e modelos mentais sólidos para tomada de decisão.',
      )
      proj2.set(
        'controllable_delivery',
        'Ler 20 páginas por dia útil e fichar 1 conceito central por semana.',
      )
      proj2.set(
        'completion_condition',
        'Completar a leitura do livro atual e produzir 4 notas de síntese.',
      )
      proj2.set('learning_asset', 'Caderno de sínteses conceituais acionáveis.')
      app.save(proj2)

      const act3 = new Record(actions)
      act3.set('user_id', ownerId)
      act3.set('project_id', proj2.id)
      act3.set('title', 'Ler capítulo 2 e destacar pontos-chave')
      act3.set('context', 'vida')
      act3.set('status', 'pronta')
      act3.set('is_next_step', false)
      act3.set('is_today_selected', false)
      app.save(act3)

      // Seed a capture
      const cap1 = new Record(captures)
      cap1.set('user_id', ownerId)
      cap1.set(
        'raw_text',
        'Avaliar viabilidade de automatizar o relatório semanal de indicadores via script',
      )
      cap1.set('status', 'pendente')
      app.save(cap1)

      // Seed progress log
      const log1 = new Record(progressLogs)
      log1.set('user_id', ownerId)
      log1.set('project_id', proj1.id)
      log1.set('action_id', act1.id)
      log1.set('log_type', 'executei')
      log1.set(
        'text',
        'Esbocei as 3 perguntas essenciais da manhã: 1. Qual é o avanço único de hoje? 2. O que pode bloquear? 3. O que não vou fazer hoje.',
      )
      const today = new Date().toISOString().split('T')[0]
      log1.set('date', today)
      app.save(log1)
    }
  },
  (app) => {
    // rollback logic if needed
  },
)
