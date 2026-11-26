/**
 * PEGADA — CONTAS (CommonJS para a JSVM do PocketBase).
 *
 * Funções pequenas usadas pelos hooks de conta: registro de acesso, regra de
 * senha e envio de e-mail. Carregue DENTRO de cada callback:
 *   var contas = require(__hooks + '/lib/contas.js')
 *
 * O registro de acesso nunca guarda senha, token nem conteúdo do método.
 */

// Senhas que aparecem em qualquer lista de vazamento e passam do mínimo de
// dez caracteres. A regra de comprimento barra as demais.
var COMUNS = [
  '1234567890',
  '0123456789',
  '12345678910',
  '123456789a',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  'qwertyuiop',
  'qwerty12345',
  'qwerty123456',
  'q1w2e3r4t5',
  'q1w2e3r4t5y6',
  'password123',
  'password1234',
  'passw0rd123',
  'senha12345',
  'senha123456',
  'minhasenha',
  'minhasenha123',
  'mudar12345',
  'mudar123456',
  'brasil12345',
  'brasil2024',
  'brasil2025',
  'brasil2026',
  'flamengo123',
  'corinthians',
  'palmeiras123',
  'iloveyou123',
  'abcdefghij',
  'abc1234567',
  'a123456789',
  'asdfghjkl1',
  'asdfghjkl;',
  'zxcvbnm123',
  '1234512345',
  '1234554321',
  '9876543210',
  '0987654321',
  '1122334455',
  '1111111111',
  '0000000000',
  'administrador',
  'admin12345',
  'admin123456',
  'welcome123',
  'bemvindo123',
  'teste12345',
  'teste123456',
  'pegada12345',
  'pegada123456',
  'usepegada123',
]

function semAcento(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Devolve o motivo (texto para a pessoa) ou '' quando a senha serve. */
function senhaFraca(senha, email, nome) {
  var s = String(senha || '')
  if (s.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.'
  if (s.length > 71) return 'A senha pode ter no máximo 71 caracteres.'
  var baixa = semAcento(s)
  if (/^(.)\1+$/.test(baixa)) return 'Essa senha repete um caractere só. Escolha outra.'
  if (COMUNS.indexOf(baixa) >= 0) return 'Essa senha é muito comum. Escolha outra.'
  var local = semAcento(String(email || '').split('@')[0])
  if (local.length >= 4 && baixa.indexOf(local) >= 0)
    return 'A senha não pode conter o seu e-mail.'
  if (email && baixa === semAcento(email)) return 'A senha não pode ser o seu e-mail.'
  var n = semAcento(nome).replace(/\s+/g, '')
  if (n.length >= 6 && baixa.indexOf(n) >= 0) return 'A senha não pode conter o seu nome.'
  return ''
}

function ipDe(e) {
  try {
    return String(e.realIP() || '').slice(0, 64)
  } catch (_) {
    return ''
  }
}

function navegadorDe(e) {
  try {
    return String(e.request.header.get('User-Agent') || '').slice(0, 200)
  } catch (_) {
    return ''
  }
}

/** Grava um evento de acesso. Falha em silêncio: registro nunca derruba o uso. */
function registrar(app, e, userId, kind, detail) {
  try {
    var rec = new Record(app.findCollectionByNameOrId('access_events'))
    if (userId) rec.set('user_id', userId)
    rec.set('kind', kind)
    rec.set('ip', e ? ipDe(e) : '')
    rec.set('agent', e ? navegadorDe(e) : '')
    rec.set('detail', String(detail || '').slice(0, 300))
    app.save(rec)
  } catch (err) {
    try {
      app.logger().warn('registro de acesso falhou', 'kind', kind, 'erro', String(err))
    } catch (_) {}
  }
}

function emailLigado(app) {
  try {
    return app.settings().smtp.enabled === true
  } catch (_) {
    return false
  }
}

function enderecoDoApp(app, e) {
  var u = ''
  try {
    u = String(app.settings().meta.appURL || '')
  } catch (_) {}
  if (!u || /localhost|127\.0\.0\.1|example\.com/.test(u)) {
    try {
      var host = String(e.request.host || '')
      var proto = String(e.request.header.get('X-Forwarded-Proto') || '')
      if (host) u = (proto || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')) + '://' + host
    } catch (_) {}
  }
  return u.replace(/\/$/, '')
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Envia um e-mail simples. Devolve true se saiu; false se não há serviço. */
function enviar(app, para, assunto, paragrafos, botao) {
  if (!emailLigado(app)) return false
  try {
    var meta = app.settings().meta
    var html =
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#17130F;max-width:520px">'
    for (var i = 0; i < paragrafos.length; i++) html += '<p>' + esc(paragrafos[i]) + '</p>'
    if (botao && botao.url)
      html +=
        '<p><a href="' +
        esc(botao.url) +
        '" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#17130F;color:#F6F1E7;text-decoration:none;font-weight:600">' +
        esc(botao.texto) +
        '</a></p><p style="font-size:13px;color:#6b635a">Se o botão não abrir, copie este endereço: ' +
        esc(botao.url) +
        '</p>'
    html += '<p style="font-size:13px;color:#6b635a">Pegada: cada passo com o seu porquê.</p></div>'
    var msg = new MailerMessage({
      from: { address: meta.senderAddress, name: meta.senderName || 'Pegada' },
      to: [{ address: para }],
      subject: assunto,
      html: html,
    })
    app.newMailClient().send(msg)
    return true
  } catch (err) {
    try {
      app.logger().warn('e-mail não saiu', 'assunto', assunto, 'erro', String(err))
    } catch (_) {}
    return false
  }
}

module.exports = {
  senhaFraca: senhaFraca,
  registrar: registrar,
  emailLigado: emailLigado,
  enderecoDoApp: enderecoDoApp,
  enviar: enviar,
}
