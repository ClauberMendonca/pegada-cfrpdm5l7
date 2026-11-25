// PEGADA — CONTAS POR CONVITE, MINHA CONTA E REGISTRO DE ACESSO.
//
// O cadastro continua fechado: uma conta só nasce de um convite criado por
// quem administra (users.role = 'admin'). O convite é um link de uso único;
// quem convida nunca conhece a senha de ninguém.
//
// Rotas (todas em /backend/v1/pegada/conta/):
//   GET  config                     público: há serviço de e-mail?
//   GET  convite/{token}            público: o convite vale? para qual e-mail?
//   POST convite/{token}/aceitar    público: cria a conta (nome, senha, fuso)
//   GET  convites                   admin: lista
//   POST convites                   admin: cria e devolve o link (uma vez)
//   POST convites/{id}/cancelar     admin
//   GET  pessoas                    admin: contas, sem conteúdo do método
//   POST pessoas/{id}/desativar     admin
//   POST pessoas/{id}/reativar      admin
//   GET  acessos                    admin: registro de acesso de todos
//   POST sair-de-todos              a pessoa encerra as outras sessões
//
// NOTA JSVM: cada callback roda isolado; a lógica comum vem de lib/contas.js,
// carregada dentro de cada um.

function contaRota(e) {
  var contas = require(__hooks + '/lib/contas.js')
  var app = e.app
  var metodo = String(e.request.method || '').toUpperCase()
  var caminho = String(e.request.url.path || '').replace(/\/+$/, '')
  var p = (caminho.split('/backend/v1/pegada/conta/')[1] || '').split('/')
  var corpo = function () {
    return e.requestInfo().body || {}
  }
  var VALIDADE_DIAS = 7

  function pessoa() {
    if (!e.auth || e.auth.collection().name !== 'users')
      throw new UnauthorizedError('Entre no app para continuar.')
    return e.auth
  }
  function admin() {
    var u = pessoa()
    if (u.getString('role') !== 'admin')
      throw new ForbiddenError('Só quem administra o Pegada pode fazer isso.')
    return u
  }
  function conviteDoToken(token) {
    if (!/^[A-Za-z0-9]{40}$/.test(String(token || ''))) return null
    try {
      return app.findFirstRecordByFilter('invites', 'token_hash = {:h}', {
        h: $security.sha256(token),
      })
    } catch (_) {
      return null
    }
  }
  function vencido(conv) {
    var fim = Date.parse(conv.getString('expires_at').replace(' ', 'T'))
    return !(fim > Date.now())
  }
  function estado(conv) {
    var st = conv.getString('status')
    if (st === 'pendente' && vencido(conv)) return 'vencido'
    return st
  }
  function existeConta(email) {
    try {
      app.findFirstRecordByFilter('users', 'email = {:e}', { e: email })
      return true
    } catch (_) {
      return false
    }
  }
  function verConvite(conv) {
    return {
      id: conv.id,
      email: conv.getString('email'),
      situacao: estado(conv),
      vence_em: conv.getString('expires_at'),
      criado_em: conv.getString('created'),
      aceito_em: conv.getString('accepted_at') || null,
    }
  }

  // ---------------------------------------------------------------- públicas
  if (metodo === 'GET' && p[0] === 'config' && p.length === 1) {
    return e.json(200, { email: contas.emailLigado(app) })
  }

  if (p[0] === 'convite' && p.length >= 2) {
    var conv = conviteDoToken(p[1])
    var st = conv ? estado(conv) : 'invalido'
    if (metodo === 'GET' && p.length === 2) {
      if (st !== 'pendente')
        return e.json(200, {
          valido: false,
          motivo:
            st === 'vencido'
              ? 'Este convite venceu. Peça um novo a quem convidou você.'
              : st === 'aceito'
                ? 'Este convite já foi usado. Entre com o seu e-mail e a sua senha.'
                : 'Este convite não vale mais. Peça um novo a quem convidou você.',
        })
      return e.json(200, { valido: true, email: conv.getString('email') })
    }
    if (metodo === 'POST' && p.length === 3 && p[2] === 'aceitar') {
      if (st !== 'pendente')
        throw new BadRequestError('Este convite não vale mais. Peça um novo a quem convidou você.')
      var b = corpo()
      var email = conv.getString('email')
      var nome = String(b.nome || '')
        .trim()
        .slice(0, 80)
      if (nome.length < 2) throw new BadRequestError('Diga como quer ser chamado(a).')
      if (b.aceito_aviso !== true)
        throw new BadRequestError('Leia e aceite o aviso de privacidade para criar a conta.')
      var fraca = contas.senhaFraca(b.senha, email, nome)
      if (fraca) throw new BadRequestError(fraca)
      if (existeConta(email))
        throw new BadRequestError('Já existe uma conta com este e-mail. Entre com a sua senha.')
      var fuso = String(b.fuso || '').slice(0, 64)
      var novoId = ''
      app.runInTransaction(function (tx) {
        var u = new Record(tx.findCollectionByNameOrId('users'))
        u.set('email', email)
        u.set('emailVisibility', false)
        u.set('verified', true) // o link chegou ao e-mail convidado
        u.set('name', nome)
        u.set('timezone', fuso)
        u.set('privacy_notice_at', new Date().toISOString().replace('T', ' '))
        u.setPassword(String(b.senha))
        tx.save(u)
        novoId = u.id
        conv.set('status', 'aceito')
        conv.set('accepted_user', u.id)
        conv.set('accepted_at', new Date().toISOString().replace('T', ' '))
        tx.save(conv)
      })
      contas.registrar(app, e, novoId, 'conta_criada', 'por convite')
      return e.json(200, { ok: true, email: email })
    }
    throw new NotFoundError('Rota de conta não encontrada.')
  }

  // ---------------------------------------------------------------- a pessoa
  if (metodo === 'POST' && p[0] === 'sair-de-todos' && p.length === 1) {
    var eu = pessoa()
    var rec = app.findRecordById('users', eu.id)
    rec.refreshTokenKey()
    app.save(rec)
    contas.registrar(app, e, rec.id, 'sessoes_encerradas', '')
    // Esta sessão continua, com um token novo; as outras caem.
    return e.json(200, { ok: true, token: rec.newAuthToken() })
  }

  // ---------------------------------------------------------------- admin
  if (p[0] === 'convites') {
    var quem = admin()
    if (metodo === 'GET' && p.length === 1) {
      var lista = app.findRecordsByFilter('invites', "id != ''", '-created', 200, 0)
      return e.json(200, {
        convites: lista.map(function (c) {
          return verConvite(c)
        }),
        email: contas.emailLigado(app),
      })
    }
    if (metodo === 'POST' && p.length === 1) {
      var alvo = String(corpo().email || '')
        .trim()
        .toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alvo) || alvo.length > 200)
        throw new BadRequestError('Informe um e-mail válido.')
      if (existeConta(alvo)) throw new BadRequestError('Essa pessoa já tem conta no Pegada.')
      // Um convite pendente por e-mail: o anterior deixa de valer.
      var antigos = app.findRecordsByFilter(
        'invites',
        "email = {:e} && status = 'pendente'",
        '-created',
        50,
        0,
        { e: alvo },
      )
      for (var i = 0; i < antigos.length; i++) {
        antigos[i].set('status', 'cancelado')
        app.save(antigos[i])
      }
      var token = $security.randomStringWithAlphabet(
        40,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      )
      var novo = new Record(app.findCollectionByNameOrId('invites'))
      novo.set('email', alvo)
      novo.set('token_hash', $security.sha256(token))
      novo.set('invited_by', quem.id)
      novo.set('status', 'pendente')
      novo.set(
        'expires_at',
        new Date(Date.now() + VALIDADE_DIAS * 86400000).toISOString().replace('T', ' '),
      )
      app.save(novo)
      var link = contas.enderecoDoApp(app, e) + '/convite/' + token
      var enviado = contas.enviar(
        app,
        alvo,
        (quem.getString('name') || 'Alguém') + ' convidou você para o Pegada',
        [
          (quem.getString('name') || 'Alguém') +
            ' convidou você para usar o Pegada, um método que liga cada passo do dia ao resultado que você escolheu.',
          'O convite vale por ' + VALIDADE_DIAS + ' dias e só pode ser usado uma vez.',
        ],
        { url: link, texto: 'Criar a minha conta' },
      )
      contas.registrar(app, e, quem.id, 'convite_criado', alvo)
      return e.json(200, {
        ok: true,
        convite: verConvite(novo),
        link: link,
        email_enviado: enviado,
        aviso: 'Guarde este link agora: ele não será mostrado de novo.',
      })
    }
    if (metodo === 'POST' && p.length === 3 && p[2] === 'cancelar') {
      var c
      try {
        c = app.findRecordById('invites', p[1])
      } catch (_) {
        throw new NotFoundError('Convite não encontrado.')
      }
      if (c.getString('status') !== 'pendente')
        throw new BadRequestError('Só um convite pendente pode ser cancelado.')
      c.set('status', 'cancelado')
      app.save(c)
      contas.registrar(app, e, quem.id, 'convite_cancelado', c.getString('email'))
      return e.json(200, { ok: true, convite: verConvite(c) })
    }
    throw new NotFoundError('Rota de conta não encontrada.')
  }

  if (p[0] === 'pessoas') {
    var adm = admin()
    if (metodo === 'GET' && p.length === 1) {
      var us = app.findRecordsByFilter('users', "id != ''", 'created', 500, 0)
      return e.json(200, {
        pessoas: us.map(function (u) {
          return {
            id: u.id,
            nome: u.getString('name'),
            email: u.getString('email'),
            administra: u.getString('role') === 'admin',
            desativada: u.getBool('disabled'),
            criada_em: u.getString('created'),
            ultimo_acesso: u.getString('last_seen_at') || null,
          }
        }),
      })
    }
    if (
      metodo === 'POST' &&
      p.length === 3 &&
      (p[2] === 'desativar' || p[2] === 'reativar')
    ) {
      var alvoU
      try {
        alvoU = app.findRecordById('users', p[1])
      } catch (_) {
        throw new NotFoundError('Conta não encontrada.')
      }
      if (alvoU.id === adm.id) throw new BadRequestError('Você não pode desativar a própria conta.')
      var desligar = p[2] === 'desativar'
      alvoU.set('disabled', desligar)
      if (desligar) alvoU.refreshTokenKey() // derruba as sessões abertas
      app.save(alvoU)
      contas.registrar(
        app,
        e,
        alvoU.id,
        desligar ? 'conta_desativada' : 'conta_reativada',
        'por quem administra',
      )
      return e.json(200, { ok: true, desativada: desligar })
    }
    throw new NotFoundError('Rota de conta não encontrada.')
  }

  if (metodo === 'GET' && p[0] === 'acessos' && p.length === 1) {
    admin()
    var evs = app.findRecordsByFilter('access_events', "id != ''", '-created', 200, 0)
    var nomes = {}
    return e.json(200, {
      acessos: evs.map(function (ev) {
        var uid = ev.getString('user_id')
        if (uid && nomes[uid] === undefined) {
          try {
            var dono = app.findRecordById('users', uid)
            nomes[uid] = dono.getString('name') || dono.getString('email')
          } catch (_) {
            nomes[uid] = ''
          }
        }
        return {
          id: ev.id,
          quem: uid ? nomes[uid] : '',
          o_que: ev.getString('kind'),
          detalhe: ev.getString('detail'),
          ip: ev.getString('ip'),
          navegador: ev.getString('agent'),
          quando: ev.getString('created'),
        }
      }),
    })
  }

  throw new NotFoundError('Rota de conta não encontrada.')
}

routerAdd('GET', '/backend/v1/pegada/conta/config', contaRota)
routerAdd('GET', '/backend/v1/pegada/conta/convite/{token}', contaRota)
routerAdd('POST', '/backend/v1/pegada/conta/convite/{token}/aceitar', contaRota)
routerAdd('GET', '/backend/v1/pegada/conta/convites', contaRota)
routerAdd('POST', '/backend/v1/pegada/conta/convites', contaRota)
routerAdd('POST', '/backend/v1/pegada/conta/convites/{id}/cancelar', contaRota)
routerAdd('GET', '/backend/v1/pegada/conta/pessoas', contaRota)
routerAdd('POST', '/backend/v1/pegada/conta/pessoas/{id}/{acao}', contaRota)
routerAdd('GET', '/backend/v1/pegada/conta/acessos', contaRota)
routerAdd('POST', '/backend/v1/pegada/conta/sair-de-todos', contaRota)

// ---------------------------------------------------------------- entrada
// Registra entradas e falhas. Na falha, a resposta ao navegador continua a
// mesma de sempre: não revela se o e-mail existe.
onRecordAuthWithPasswordRequest((e) => {
  const contas = require(__hooks + '/lib/contas.js')
  const quem = e.record ? e.record.id : ''
  try {
    e.next()
  } catch (err) {
    contas.registrar(e.app, e, quem, 'falha_entrada', quem ? '' : 'e-mail desconhecido')
    throw err
  }
  if (e.record) {
    contas.registrar(e.app, e, e.record.id, 'entrada', '')
    try {
      const rec = e.app.findRecordById('users', e.record.id)
      rec.set('last_seen_at', new Date().toISOString().replace('T', ' '))
      e.app.save(rec)
    } catch (_) {}
  }
}, 'users')

onRecordAuthRefreshRequest((e) => {
  e.next()
  try {
    const rec = e.app.findRecordById('users', e.record.id)
    const antes = Date.parse(rec.getString('last_seen_at').replace(' ', 'T')) || 0
    if (Date.now() - antes > 3600000) {
      rec.set('last_seen_at', new Date().toISOString().replace('T', ' '))
      e.app.save(rec)
    }
  } catch (_) {}
}, 'users')

// ---------------------------------------------------------------- senha
onRecordRequestPasswordResetRequest((e) => {
  const contas = require(__hooks + '/lib/contas.js')
  if (e.record) contas.registrar(e.app, e, e.record.id, 'recuperacao_pedida', '')
  return e.next()
}, 'users')

onRecordConfirmPasswordResetRequest((e) => {
  const contas = require(__hooks + '/lib/contas.js')
  const b = e.requestInfo().body || {}
  if (e.record) {
    const fraca = contas.senhaFraca(b.password, e.record.getString('email'), e.record.getString('name'))
    if (fraca) throw new BadRequestError(fraca)
  }
  e.next()
  if (e.record) {
    contas.registrar(e.app, e, e.record.id, 'senha_redefinida', 'pelo link do e-mail')
    contas.enviar(e.app, e.record.getString('email'), 'A sua senha do Pegada foi trocada', [
      'A senha da sua conta no Pegada acaba de ser redefinida pelo link de recuperação.',
      'Se não foi você, peça uma nova senha agora e avise quem administra o Pegada.',
    ])
  }
}, 'users')

onRecordConfirmEmailChangeRequest((e) => {
  const contas = require(__hooks + '/lib/contas.js')
  const antigo = e.record ? e.record.getString('email') : ''
  e.next()
  if (e.record) {
    contas.registrar(e.app, e, e.record.id, 'email_trocado', '')
    if (antigo)
      contas.enviar(e.app, antigo, 'O e-mail da sua conta no Pegada foi trocado', [
        'O e-mail de entrada da sua conta no Pegada foi trocado para ' + e.record.getString('email') + '.',
        'Se não foi você, avise quem administra o Pegada.',
      ])
  }
}, 'users')

// ---------------------------------------------------------------- servidor
// Serviço de e-mail vindo dos segredos do servidor (nada de senha no banco
// por migration). Sem PEGADA_SMTP_HOST o app segue sem e-mail: o convite vira
// um link para copiar e a recuperação de senha avisa que não está disponível.
//   PEGADA_SMTP_HOST, PEGADA_SMTP_PORT (padrão 587), PEGADA_SMTP_USER,
//   PEGADA_SMTP_PASS, PEGADA_EMAIL_REMETENTE (ex.: ola@usepegada.com.br),
//   PEGADA_URL (endereço público do app, usado nos links dos e-mails).
onBootstrap((e) => {
  e.next()
  try {
    const s = e.app.settings()
    const host = $os.getenv('PEGADA_SMTP_HOST')
    const url = $os.getenv('PEGADA_URL')
    let mudou = false
    if (url && s.meta.appURL !== url) {
      s.meta.appURL = url
      mudou = true
    }
    if (s.meta.appName !== 'Pegada') {
      s.meta.appName = 'Pegada'
      mudou = true
    }
    if (host) {
      const porta = parseInt($os.getenv('PEGADA_SMTP_PORT') || '587', 10)
      const remetente = $os.getenv('PEGADA_EMAIL_REMETENTE')
      const novo = {
        enabled: true,
        host: host,
        port: porta,
        username: $os.getenv('PEGADA_SMTP_USER'),
        password: $os.getenv('PEGADA_SMTP_PASS'),
        tls: porta === 465,
      }
      if (
        !s.smtp.enabled ||
        s.smtp.host !== novo.host ||
        s.smtp.port !== novo.port ||
        s.smtp.username !== novo.username ||
        s.smtp.password !== novo.password
      ) {
        s.smtp.enabled = true
        s.smtp.host = novo.host
        s.smtp.port = novo.port
        s.smtp.username = novo.username
        s.smtp.password = novo.password
        s.smtp.tls = novo.tls
        mudou = true
      }
      if (remetente && s.meta.senderAddress !== remetente) {
        s.meta.senderAddress = remetente
        s.meta.senderName = 'Pegada'
        mudou = true
      }
    } else if (s.smtp.enabled) {
      s.smtp.enabled = false
      mudou = true
    }
    if (mudou) e.app.save(s)
  } catch (err) {
    console.log('PEGADA: não consegui aplicar a configuração de e-mail: ' + err)
  }
})

// O registro de acesso guarda 180 dias. Limpeza toda segunda, 04:00 de Brasília.
cronAdd('pegada_limpa_acessos', '0 7 * * 1', () => {
  const corte = new Date(Date.now() - 180 * 86400000).toISOString().replace('T', ' ')
  try {
    $app
      .db()
      .newQuery('DELETE FROM access_events WHERE created < {:c}')
      .bind({ c: corte })
      .execute()
    $app
      .db()
      .newQuery("DELETE FROM invites WHERE status != 'pendente' AND created < {:c}")
      .bind({ c: corte })
      .execute()
  } catch (err) {
    console.log('PEGADA: limpeza do registro de acesso falhou: ' + err)
  }
})

// Cabeçalhos de segurança nas telas e na API (o painel /_/ fica como está).
routerUse((e) => {
  const caminho = String(e.request.url.path || '')
  const h = e.response.header()
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (caminho.indexOf('/_/') !== 0) {
    h.set('X-Frame-Options', 'DENY')
    h.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    )
  }
  if (String(e.request.header.get('X-Forwarded-Proto') || '') === 'https')
    h.set('Strict-Transport-Security', 'max-age=31536000')
  return e.next()
})
