// Guardas de segurança no servidor (P0):
// - bloqueia criação pública de contas (conta só nasce de convite, em contas.pb.js)
//   e limita o que a pessoa altera no próprio perfil pela API comum;
// - deriva e valida o proprietário (user_id) da sessão autenticada em toda escrita;
// - valida relações (dono + consistência) de projects, actions, captures e progress_logs;
// - nega exclusão definitiva pela API comum (arquivamento lógico permanece).
// Superusuário (painel admin) contorna estas guardas por design.
// NOTA: o JSVM executa callbacks em pool separado — toda a lógica fica INLINE nos callbacks.

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  // Fechar cadastro público: apenas superusuário cria contas (painel admin).
  throw new ForbiddenError('Criação de contas não é permitida pela API do app.')
}, 'users')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  if (e.record.id !== e.auth.id) throw new ForbiddenError()
  const contas = require(__hooks + '/lib/contas.js')
  // Pelo app a pessoa muda: nome, foto, fuso e a própria senha (o PocketBase
  // exige a senha atual). O resto tem caminho próprio:
  // - e-mail: troca com confirmação no endereço novo (request-email-change);
  // - life_purpose: API do método (definir_proposito), com histórico;
  // - role, disabled e os demais: só quem administra, pelas rotas de conta.
  const travados = [
    'email',
    'verified',
    'emailVisibility',
    'tokenKey',
    'life_purpose',
    'role',
    'disabled',
    'last_seen_at',
    'privacy_notice_at',
    'ai_day',
    'ai_count',
  ]
  for (const f of travados) {
    if (String(e.record.get(f)) !== String(e.record.original().get(f))) {
      throw new ForbiddenError('Alteração de "' + f + '" não é permitida pela API do app.')
    }
  }
  const b = e.requestInfo().body || {}
  const trocaSenha = typeof b.password === 'string' && b.password !== ''
  if (trocaSenha) {
    const fraca = contas.senhaFraca(b.password, e.record.getString('email'), e.record.getString('name'))
    if (fraca) throw new BadRequestError(fraca)
  }
  const nome = e.record.getString('name').trim()
  if (nome !== e.record.original().getString('name')) {
    if (nome.length < 2 || nome.length > 80)
      throw new BadRequestError('O nome precisa ter de 2 a 80 caracteres.')
    e.record.set('name', nome)
  }
  e.next()
  if (trocaSenha) {
    contas.registrar(e.app, e, e.record.id, 'senha_trocada', 'em Minha conta')
    contas.enviar(e.app, e.record.getString('email'), 'A sua senha do Pegada foi trocada', [
      'A senha da sua conta no Pegada acaba de ser trocada em Minha conta. As sessões abertas em outros aparelhos foram encerradas.',
      'Se não foi você, use "Esqueci a senha" na tela de entrada e avise quem administra o Pegada.',
    ])
  }
}, 'users')

onRecordDeleteRequest(
  (e) => {
    if (e.hasSuperuserAuth()) return e.next()
    throw new ForbiddenError('Exclusão definitiva não é permitida pela API do app.')
  },
  'users',
  'projects',
  'actions',
  'captures',
  'progress_logs',
)

// ---------- projects ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  // Proprietário sempre deriva da sessão; payload nunca decide o dono.
  e.record.set('user_id', e.auth.id)
  return e.next()
}, 'projects')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  return e.next()
}, 'projects')

// ---------- actions ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const relId = e.record.getString('project_id')
  if (relId) {
    let project
    try {
      project = e.app.findRecordById('projects', relId)
    } catch (_) {
      throw new BadRequestError('Projeto relacionado inválido.')
    }
    if (project.getString('user_id') !== e.auth.id) {
      throw new ForbiddenError('Projeto relacionado pertence a outro usuário.')
    }
    if (project.getString('context') !== e.record.getString('context')) {
      throw new BadRequestError('Contexto da ação difere do contexto do projeto.')
    }
  }
  return e.next()
}, 'actions')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const relId = e.record.getString('project_id')
  if (relId) {
    let project
    try {
      project = e.app.findRecordById('projects', relId)
    } catch (_) {
      throw new BadRequestError('Projeto relacionado inválido.')
    }
    if (project.getString('user_id') !== e.auth.id) {
      throw new ForbiddenError('Projeto relacionado pertence a outro usuário.')
    }
    if (project.getString('context') !== e.record.getString('context')) {
      throw new BadRequestError('Contexto da ação difere do contexto do projeto.')
    }
  }
  return e.next()
}, 'actions')

// ---------- captures ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const rels = [
    ['converted_project_id', 'projects'],
    ['converted_action_id', 'actions'],
  ]
  for (const rel of rels) {
    const relId = e.record.getString(rel[0])
    if (relId) {
      let target
      try {
        target = e.app.findRecordById(rel[1], relId)
      } catch (_) {
        throw new BadRequestError('Relação inválida em ' + rel[0] + '.')
      }
      if (target.getString('user_id') !== e.auth.id) {
        throw new ForbiddenError('Registro relacionado em ' + rel[0] + ' pertence a outro usuário.')
      }
    }
  }
  return e.next()
}, 'captures')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const rels = [
    ['converted_project_id', 'projects'],
    ['converted_action_id', 'actions'],
  ]
  for (const rel of rels) {
    const relId = e.record.getString(rel[0])
    if (relId) {
      let target
      try {
        target = e.app.findRecordById(rel[1], relId)
      } catch (_) {
        throw new BadRequestError('Relação inválida em ' + rel[0] + '.')
      }
      if (target.getString('user_id') !== e.auth.id) {
        throw new ForbiddenError('Registro relacionado em ' + rel[0] + ' pertence a outro usuário.')
      }
    }
  }
  return e.next()
}, 'captures')

// ---------- progress_logs ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const project = e.record.getString('project_id')
    ? (() => {
        try {
          return e.app.findRecordById('projects', e.record.getString('project_id'))
        } catch (_) {
          throw new BadRequestError('Projeto relacionado inválido.')
        }
      })()
    : null
  const action = e.record.getString('action_id')
    ? (() => {
        try {
          return e.app.findRecordById('actions', e.record.getString('action_id'))
        } catch (_) {
          throw new BadRequestError('Ação relacionada inválida.')
        }
      })()
    : null
  if (project && project.getString('user_id') !== e.auth.id) {
    throw new ForbiddenError('Projeto relacionado pertence a outro usuário.')
  }
  if (action && action.getString('user_id') !== e.auth.id) {
    throw new ForbiddenError('Ação relacionada pertence a outro usuário.')
  }
  if (!project && !action) {
    throw new BadRequestError('Registro de progresso exige ação e/ou projeto.')
  }
  if (project && action && action.getString('project_id') !== project.id) {
    throw new BadRequestError('Ação e projeto do registro de progresso não são consistentes.')
  }
  return e.next()
}, 'progress_logs')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  e.record.set('user_id', e.auth.id)
  const project = e.record.getString('project_id')
    ? (() => {
        try {
          return e.app.findRecordById('projects', e.record.getString('project_id'))
        } catch (_) {
          throw new BadRequestError('Projeto relacionado inválido.')
        }
      })()
    : null
  const action = e.record.getString('action_id')
    ? (() => {
        try {
          return e.app.findRecordById('actions', e.record.getString('action_id'))
        } catch (_) {
          throw new BadRequestError('Ação relacionada inválida.')
        }
      })()
    : null
  if (project && project.getString('user_id') !== e.auth.id) {
    throw new ForbiddenError('Projeto relacionado pertence a outro usuário.')
  }
  if (action && action.getString('user_id') !== e.auth.id) {
    throw new ForbiddenError('Ação relacionada pertence a outro usuário.')
  }
  if (!project && !action) {
    throw new BadRequestError('Registro de progresso exige ação e/ou projeto.')
  }
  if (project && action && action.getString('project_id') !== project.id) {
    throw new BadRequestError('Ação e projeto do registro de progresso não são consistentes.')
  }
  return e.next()
}, 'progress_logs')
