/**
 * FATIA 6A2 — RECORRÊNCIA: CALENDÁRIO FIXO / AVALIADOR DE DATAS (cálculo puro)
 *
 * Módulo CommonJS puro para a JSVM (goja) do PocketBase. NÃO é *.pb.js — nada
 * é registrado automaticamente; o consumidor FUTURO fará
 * `require(__hooks + '/lib/recurrence-calendar.js')` DENTRO do callback.
 *
 * Limites desta fatia:
 * - Só cálculo/validação: NÃO cria coleção de séries, vínculo em actions,
 *   ocorrência, contador, endpoint, editor, comando automático, hook
 *   consumidor ou cron. Avaliador pronto NÃO significa recorrência ativada.
 * - Sem Intl, window, timers, ESM/TS ou dependência externa; nenhum
 *   Date.now()/new Date() sem argumento (nada de relógio do dispositivo).
 * - Sem estado compartilhado mutável nem cache; sem leitura de perfil/banco,
 *   sem $app/HTTP/exec/arquivo além do próprio carregamento do módulo.
 * - Sem parser de texto natural/RRULE/importação.
 *
 * Regra JSON v1 (contrato espelhado em src/types/recurrence.ts):
 * {
 *   version: 1,
 *   mode: 'calendar' | 'after_completion',
 *   start_date: 'YYYY-MM-DD',        // data REAL (2027-02-30 é inválida)
 *   planned_time: '' | 'HH:mm',      // opcional; ausente = apenas sem hora
 *   timezone: 'America/Sao_Paulo',   // IANA explícita ou 'UTC' — aqui só
 *                                    // FORMATO é conferido; existência do
 *                                    // nome IANA é da camada nativa (fuso)
 *   end: { kind: 'never' } |
 *        { kind: 'date', date: 'YYYY-MM-DD' } | // inclusiva
 *        { kind: 'count', count: 5 },           // ocorrências previstas
 *   repeat: { unit: 'day', interval: 1 } |
 *           { unit: 'week', interval: 1, weekdays: [1,3,5] } |
 *           { unit: 'month', interval: 1, selector: { kind: 'day', day: 31 } } |
 *           { unit: 'month', interval: 1, selector: { kind: 'last_day' } } |
 *           { unit: 'month', interval: 1, selector: { kind: 'weekday', weekday: 1, position: 1 | 'last' } } |
 *           { unit: 'year', interval: 1, month: 1, day: 31 }
 * }
 * Em after_completion, repeat tem SÓ unit + interval (sem weekdays/selector/
 * month/day). Campos incompatíveis da alternativa são REJEITADOS, nunca
 * corrigidos silenciosamente. Dias mensais/anuais são NOMINAIS 1..31 com
 * ajuste explícito de mês curto (dia 31 em mês de 30 vira o último válido,
 * mas o nominal continua 31 para os próximos meses). Sem feriados.
 */

'use strict'

// Orçamento finito de trabalho por avaliação (protege a JSVM de varrer
// milhões de períodos). Excedido => estado 'limit', nunca falso término.
var RC_MAX_PERIODS = 10000

var RC_MAX_ORDINAL = 9007199254740991 // inteiro seguro máximo

// ---------------------------------------------------------------------------
// ARITMÉTICA CIVIL
// Date UTC usada SÓ como mecanismo de aritmética independente de fuso — nunca
// como significado/salvamento do plano (o dia civil 'YYYY-MM-DD' é o valor).
// setUTCFullYear define anos 00..99 explicitamente (setFullYear de 2 dígitos
// deslocaria para 1900+aa) e nada passa por Date.parse.
// ---------------------------------------------------------------------------

function _makeUTC(y, m, d) {
  var dt = new Date(0)
  dt.setUTCFullYear(y, m - 1, d)
  dt.setUTCHours(12, 0, 0, 0) // meio-dia: sem risco de borda de dia civil
  return dt
}

function _isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function _daysInMonth(y, m) {
  var table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m === 2 && _isLeap(y)) return 29
  return table[m - 1]
}

function _pad2(n) {
  return (n < 10 ? '0' : '') + n
}

// Ano sempre em 4 dígitos (inclusive anos < 1000) — sem deslocamento de 1900.
function _pad4(n) {
  var s = String(n)
  while (s.length < 4) s = '0' + s
  return s
}

function _toCivil(y, m, d) {
  return _pad4(y) + '-' + _pad2(m) + '-' + _pad2(d)
}

function _isInteger(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v
}

function _isSafePositive(v) {
  return _isInteger(v) && v >= 1 && v <= RC_MAX_ORDINAL
}

// Segunda=1 .. Domingo=7 (ISO). Date UTC getUTCDay(): 0=Dom..6=Sáb.
function _isoWeekday(dt) {
  var d = dt.getUTCDay()
  return d === 0 ? 7 : d
}

// Segunda-feira da semana (ISO) da data.
function _mondayOf(dt) {
  var m = _makeUTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  var wd = _isoWeekday(m)
  m.setUTCDate(m.getUTCDate() - (wd - 1))
  return m
}

// ---------------------------------------------------------------------------
// VALIDAÇÃO PURA (formato/estrutura — NÃO certifica catálogo IANA)
// ---------------------------------------------------------------------------

// 'YYYY-MM-DD': 4 dígitos (0001..9999), '-' literais, mês 01..12, dia real.
// Nada de normalização permissiva (31/02 NÃO vira março).
function isValidCivilDate(s) {
  if (typeof s !== 'string' || s.length !== 10) return false
  if (s.charAt(4) !== '-' || s.charAt(7) !== '-') return false
  for (var i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue
    var c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  var y = parseInt(s.slice(0, 4), 10)
  var m = parseInt(s.slice(5, 7), 10)
  var d = parseInt(s.slice(8, 10), 10)
  if (y < 1 || y > 9999 || m < 1 || m > 12) return false
  return d >= 1 && d <= _daysInMonth(y, m)
}

// 'HH:mm' exato (00:00 válido; '' é SEM hora, tratado antes).
function isValidPlannedTime(s) {
  if (s === '') return true
  if (typeof s !== 'string' || s.length !== 5) return false
  if (s.charAt(2) !== ':') return false
  var h = parseInt(s.slice(0, 2), 10)
  var mi = parseInt(s.slice(3, 5), 10)
  if (isNaN(h) || isNaN(mi)) return false
  if (s.slice(0, 2) !== _pad2(h) || s.slice(3, 5) !== _pad2(mi)) return false
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59
}

function _err(field, reason) {
  return { field: field, reason: reason }
}

// Motivos padronizados (estáveis, para o editor futuro / diagnóstico):
//  version | mode | start_date | planned_time | timezone | end | end.kind |
//  end.date | end.count | repeat | repeat.unit | repeat.interval |
//  repeat.weekdays | repeat.selector | repeat.month | repeat.day |
//  repeat.weekday | repeat.position | from_date | limit | completed_at | ordinal
function validateRule(rule) {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    return { ok: false, errors: [_err('rule', 'rule deve ser objeto')] }
  }
  var errors = []

  if (rule.version !== 1) {
    errors.push(_err('version', 'somente version:1 nesta fatia'))
  }

  if (rule.mode !== 'calendar' && rule.mode !== 'after_completion') {
    errors.push(_err('mode', "mode deve ser 'calendar' ou 'after_completion'"))
  }

  if (!isValidCivilDate(rule.start_date)) {
    errors.push(_err('start_date', 'data real YYYY-MM-DD (ano 0001..9999)'))
  }

  if (rule.planned_time === undefined || rule.planned_time === null) {
    // ausente = apenas sem hora — legítimo
  } else if (!isValidPlannedTime(rule.planned_time)) {
    errors.push(_err('planned_time', "'' (sem hora) ou HH:mm 00:00..23:59"))
  }

  // Fuso: formato apenas (não vazio, não 'Local', sem offset numérico). A
  // existência do nome IANA é validada pela camada nativa (recurrence-timezone).
  if (typeof rule.timezone !== 'string' || rule.timezone.length === 0) {
    errors.push(_err('timezone', 'fuso IANA explícito ou UTC (nunca vazio)'))
  } else if (rule.timezone === 'Local') {
    errors.push(_err('timezone', "'Local' não é referência — use IANA explícito ou UTC"))
  } else if (
    /[+]/.test(rule.timezone) ||
    /^-/.test(rule.timezone) ||
    /^-?[0-9]/.test(rule.timezone)
  ) {
    errors.push(
      _err('timezone', 'offset numérico não é referência — use nome IANA explícito ou UTC'),
    )
  }

  // end
  var end = rule.end
  var endKind = null
  if (end === null || typeof end !== 'object' || Array.isArray(end)) {
    errors.push(_err('end', 'end obrigatório: never | date | count'))
  } else {
    endKind = end.kind
    if (endKind === 'never') {
      if (end.date !== undefined || end.count !== undefined) {
        errors.push(_err('end', "end.kind='never' não aceita date/count"))
      }
    } else if (endKind === 'date') {
      if (!isValidCivilDate(end.date)) {
        errors.push(_err('end.date', 'data real YYYY-MM-DD (inclusiva)'))
      } else if (isValidCivilDate(rule.start_date) && end.date < rule.start_date) {
        errors.push(_err('end.date', 'término anterior ao começo'))
      }
    } else if (endKind === 'count') {
      if (!_isSafePositive(end.count)) {
        errors.push(_err('end.count', 'inteiro positivo (sem string/float/boolean)'))
      }
    } else {
      errors.push(_err('end.kind', "kind deve ser 'never' | 'date' | 'count'"))
    }
  }

  // repeat — união discriminada; campos incompatíveis são rejeitados.
  var rep = rule.repeat
  if (rep === null || typeof rep !== 'object' || Array.isArray(rep)) {
    errors.push(_err('repeat', 'repeat obrigatório'))
  } else {
    var unit = rep.unit
    var interval = rep.interval
    if (unit !== 'day' && unit !== 'week' && unit !== 'month' && unit !== 'year') {
      errors.push(_err('repeat.unit', "unit deve ser 'day' | 'week' | 'month' | 'year'"))
    } else if (!_isSafePositive(interval)) {
      errors.push(_err('repeat.interval', 'interval deve ser inteiro positivo'))
    } else if (rule.mode === 'after_completion') {
      // Sem seletores de calendário neste modo.
      if (
        rep.weekdays !== undefined ||
        rep.selector !== undefined ||
        rep.month !== undefined ||
        rep.day !== undefined
      ) {
        errors.push(
          _err(
            'repeat',
            'after_completion não aceita weekdays/selector/month/day — só unit + interval',
          ),
        )
      }
    } else {
      // mode === 'calendar'
      if (unit === 'day') {
        if (
          rep.weekdays !== undefined ||
          rep.selector !== undefined ||
          rep.month !== undefined ||
          rep.day !== undefined
        ) {
          errors.push(_err('repeat', "{unit:'day'} não aceita weekdays/selector/month/day"))
        }
      } else if (unit === 'week') {
        if (rep.selector !== undefined || rep.month !== undefined || rep.day !== undefined) {
          errors.push(_err('repeat', "{unit:'week'} não aceita selector/month/day"))
        }
        var wd = rep.weekdays
        if (!Array.isArray(wd) || wd.length === 0) {
          errors.push(_err('repeat.weekdays', 'lista semanal não pode ser vazia'))
        } else {
          var seen = {}
          var prev = 0
          for (var i = 0; i < wd.length; i++) {
            var v = wd[i]
            if (!_isInteger(v) || v < 1 || v > 7) {
              errors.push(_err('repeat.weekdays', 'dias 1..7 inteiros (segunda=1..domingo=7)'))
              break
            }
            if (seen[v]) {
              errors.push(_err('repeat.weekdays', 'dias sem duplicação'))
              break
            }
            if (v <= prev) {
              errors.push(_err('repeat.weekdays', 'dias em ordem crescente'))
              break
            }
            seen[v] = true
            prev = v
          }
        }
      } else if (unit === 'month') {
        if (rep.weekdays !== undefined || rep.month !== undefined || rep.day !== undefined) {
          errors.push(_err('repeat', "{unit:'month'} não aceita weekdays/month/day — use selector"))
        }
        var sel = rep.selector
        if (sel === null || typeof sel !== 'object' || Array.isArray(sel)) {
          errors.push(_err('repeat.selector', 'selector obrigatório no mensal'))
        } else {
          if (sel.kind === 'day') {
            if (!_isInteger(sel.day) || sel.day < 1 || sel.day > 31) {
              errors.push(_err('repeat.day', 'dia nominal 1..31 (ajuste de mês curto é explícito)'))
            }
            if (sel.position !== undefined) {
              errors.push(_err('repeat.selector', "{kind:'day'} não aceita position"))
            }
          } else if (sel.kind === 'last_day') {
            if (sel.day !== undefined || sel.position !== undefined) {
              errors.push(_err('repeat.selector', "{kind:'last_day'} não aceita day/position"))
            }
          } else if (sel.kind === 'weekday') {
            if (!_isInteger(sel.weekday) || sel.weekday < 1 || sel.weekday > 7) {
              errors.push(_err('repeat.weekday', 'weekday 1..7 (segunda=1..domingo=7)'))
            }
            var pos = sel.position
            var posOk = pos === 'last' || (_isInteger(pos) && pos >= 1 && pos <= 5)
            if (!posOk) {
              errors.push(_err('repeat.position', "position 1..5 ou 'last'"))
            }
            if (sel.day !== undefined) {
              errors.push(_err('repeat.selector', "{kind:'weekday'} não aceita day"))
            }
          } else {
            errors.push(_err('repeat.selector', "kind deve ser 'day' | 'last_day' | 'weekday'"))
          }
        }
      } else {
        // year
        if (rep.weekdays !== undefined || rep.selector !== undefined) {
          errors.push(_err('repeat', "{unit:'year'} não aceita weekdays/selector"))
        }
        if (!_isInteger(rep.month) || rep.month < 1 || rep.month > 12) {
          errors.push(_err('repeat.month', 'mês 1..12'))
        }
        if (!_isInteger(rep.day) || rep.day < 1 || rep.day > 31) {
          errors.push(_err('repeat.day', 'dia nominal 1..31 (ajuste de ano comum é explícito)'))
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors }
  }
  // Validação pura ok: ok:true NÃO certifica catálogo IANA — a composição
  // completa passa antes pela camada nativa de fuso (recurrence-timezone).
  return { ok: true, errors: [] }
}

// ---------------------------------------------------------------------------
// GERAÇÃO DO CALENDÁRIO — calendar
// Um período (k-ésimo salto) produz NO MÁXIMO uma data (sem duplicatas);
// ocorrência nenhuma no período (ex.: 5ª quinta inexistente) não consome
// ordinal. Datas < start_date são excluídas e NÃO consomem ordinal/count.
// ---------------------------------------------------------------------------

// Data da ocorrência (ou null) para o período k (k = 0, 1, 2, ...) do repeat.
// Para day/week: k conta períodos diretamente. Para month/year: k conta
// períodos (meses/anos-alvo a cada N a partir do período de start_date).
function _occurrenceForPeriod(rule, k) {
  var rep = rule.repeat
  var start = rule.start_date
  var sy = parseInt(start.slice(0, 4), 10)
  var sm = parseInt(start.slice(5, 7), 10)
  var sd = parseInt(start.slice(8, 10), 10)
  var unit = rep.unit
  var n = rep.interval

  if (unit === 'day') {
    var d = _makeUTC(sy, sm, sd)
    d.setUTCDate(d.getUTCDate() + k * n)
    return _makeUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }

  if (unit === 'week') {
    // Semanas ancoradas na SEGUNDA-FEIRA da semana de start_date.
    var anchor = _mondayOf(_makeUTC(sy, sm, sd))
    anchor.setUTCDate(anchor.getUTCDate() + k * n * 7)
    return anchor // o dia exato é escolhido entre os weekdays da semana
  }

  if (unit === 'month') {
    // Meses-alvo ancorados no mês inicial, a cada N.
    var total = sm - 1 + k * n
    var y = sy + Math.floor(total / 12)
    var mo = (total % 12) + 1
    var sel = rep.selector
    if (sel.kind === 'last_day') {
      return _makeUTC(y, mo, _daysInMonth(y, mo))
    }
    if (sel.kind === 'day') {
      // Dia nominal preservado; ajuste explícito ao último válido do mês.
      var dd = Math.min(sel.day, _daysInMonth(y, mo))
      return _makeUTC(y, mo, dd)
    }
    // weekday: posição calculada NAQUELE mês; 5ª posição inexistente => null
    // (nenhuma ocorrência prevista no período, sem ordinal consumido).
    var first = _makeUTC(y, mo, 1)
    var firstWd = _isoWeekday(first)
    var dim = _daysInMonth(y, mo)
    if (sel.position === 'last') {
      var last = _makeUTC(y, mo, dim)
      var lastWd = _isoWeekday(last)
      var back = (lastWd - sel.weekday + 7) % 7
      return _makeUTC(y, mo, dim - back)
    }
    var offset = (sel.weekday - firstWd + 7) % 7
    var dayN = 1 + offset + (sel.position - 1) * 7
    if (dayN > dim) return null // posição não existe neste mês
    return _makeUTC(y, mo, dayN)
  }

  // year — anos-alvo a cada N a partir do ano inicial; mês/dia nominais
  // preservados; 29/02 vira 28/02 em ano comum e volta a 29 no bissexto.
  var y2 = sy + k * n
  var dd2 = Math.min(rep.day, _daysInMonth(y2, rep.month))
  return _makeUTC(y2, rep.month, dd2)
}

// Lista os dias candidatos (0..n) de um período semanal k (as weekdays, em
// ordem) como datas civis >= start_date (excluídas as anteriores, sem
// consumir ordinal). Retorna array de Date UTC.
function _weekCandidateDates(rule, k) {
  var start = rule.start_date
  var sy = parseInt(start.slice(0, 4), 10)
  var sm = parseInt(start.slice(5, 7), 10)
  var sd = parseInt(start.slice(8, 10), 10)
  var startUTC = _makeUTC(sy, sm, sd)
  var anchor = _occurrenceForPeriod(rule, k) // segunda-feira da semana k
  var out = []
  for (var i = 0; i < rule.repeat.weekdays.length; i++) {
    var wd = rule.repeat.weekdays[i]
    var cand = _makeUTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + 1,
      anchor.getUTCDate() + (wd - 1),
    )
    if (cand.getTime() >= startUTC.getTime()) out.push(cand)
  }
  return out
}

function _fmt(dt) {
  return (
    _pad4(dt.getUTCFullYear()) + '-' + _pad2(dt.getUTCMonth() + 1) + '-' + _pad2(dt.getUTCDate())
  )
}

// Datas previstas >= from_date (string 'YYYY-MM-DD' — data real, explicita,
// nunca "hoje"). Ordinais são ESTÁVEIS no calendário original desde
// start_date: pedir prévia a partir de data posterior não reinicia em 1 —
// datas anteriores a from_date mas >= start_date continuam consumindo
// ordinal/count mesmo não materializadas. end.date é inclusiva; nunca avança
// além do término para preencher o limit. Retorna:
//   { state, dates: [{date, ordinal}], reason? } — state: 'pronto' |
//   'termino' | 'limit' | 'invalida' ; retorno vazio não significa encerrada.
function previewCalendar(rule, from_date, limit) {
  var v = validateRule(rule)
  if (!v.ok) return { state: 'invalida', dates: [], reason: v.errors[0] }
  if (!isValidCivilDate(from_date)) {
    return { state: 'invalida', dates: [], reason: _err('from_date', 'data real YYYY-MM-DD') }
  }
  var lim = limit === undefined ? 5 : limit
  if (!_isInteger(lim) || lim < 1 || lim > 5) {
    return { state: 'invalida', dates: [], reason: _err('limit', 'inteiro 1..5') }
  }

  var rep = rule.repeat
  var unit = rep.unit
  var dates = []
  var ordinal = 0
  var periods = 0
  var fromUtc = _makeUTC(
    parseInt(from_date.slice(0, 4), 10),
    parseInt(from_date.slice(5, 7), 10),
    parseInt(from_date.slice(8, 10), 10),
  )

  var isWeekly = unit === 'week'

  while (dates.length < lim) {
    if (periods >= RC_MAX_PERIODS) {
      // Orçamento excedido: limite EXPLÍCITO — nunca falso término nem lista
      // truncada apresentada como completa.
      return {
        state: 'limit',
        dates: dates,
        reason: _err('preview', 'orçamento de períodos excedido desde from_date'),
      }
    }
    periods++

    var candidates = []
    if (isWeekly) {
      candidates = _weekCandidateDates(rule, periods - 1)
    } else {
      var occ = _occurrenceForPeriod(rule, periods - 1)
      if (occ !== null) candidates = [occ]
    }

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i]
      var candStr = _fmt(cand)

      // start_date é o limite inicial do calendário (defensivo: _weekCandidate
      // já exclui, mas as outras unidades ancoram no próprio start_date).
      if (candStr < rule.start_date) continue // não consome ordinal/count

      if (rule.end.kind === 'date' && candStr > rule.end.date) {
        // Término inclusiva alcançado/ultrapassado: término REAL da série.
        return { state: 'termino', dates: dates, reason: _err('end.date', 'limite final atingido') }
      }

      // end.count conta ocorrências PREVISTAS (incluindo anteriores a
      // from_date), não concluídas nem materializadas.
      if (rule.end.kind === 'count') {
        if (ordinal + 1 > rule.end.count) {
          return {
            state: 'termino',
            dates: dates,
            reason: _err('end.count', 'contagem de ocorrências previstas esgotada'),
          }
        }
        ordinal++
        if (cand.getTime() < fromUtc.getTime()) continue // prevista, mas antes de from_date
      } else {
        // Ordinal é ESTÁVEL no calendário original desde start_date: candidata
        // anterior a from_date (mas >= start_date) também consome ordinal —
        // prévia a partir de data posterior NÃO reinicia em 1.
        ordinal++
        if (cand.getTime() < fromUtc.getTime()) continue // anterior a from_date
      }
      dates.push({ date: candStr, ordinal: ordinal })
      if (dates.length >= lim) break
    }
  }

  // 'pronto': há candidatos; retorno NÃO significa série sem fim nem que as
  // datas estão materializadas — é só previsão do calendário fixo.
  return { state: 'pronto', dates: dates }
}

// ---------------------------------------------------------------------------
// APÓS CONCLUSÃO — SOMENTE O PRÓXIMO CANDIDATO
// Cálculo puro: recebe regra validada, dia LOCAL da conclusão (derivado do
// completed_at UTC pela camada nativa de fuso) e o ordinal da ocorrência
// concluída (futuramente do estado persistido — nunca posição de lista).
// NENHUMA consulta a actions aqui; nada é materializado nem autenticado.
// ---------------------------------------------------------------------------

// completedLocalDate: 'YYYY-MM-DD' do dia civil da conclusão no fuso da regra
// (derivado fora daqui). completedOrdinal: ordinal da ocorrência concluída.
// Retorna SOMENTE o próximo candidato (ordinal anterior + 1) ou estado:
//   { state:'aguardando' }             — sem âncora conhecida (nada inventado)
//   { state:'invalida', reason }       — entrada inválida
//   { state:'termino', reason }        — término real (count esgotado / passou
//                                        do end.date)
//   { state:'candidato', candidate }   — {date, ordinal, adjusted_to_start?}
// Reconcluir/reabrir não produz âncora nova — quem chama decide a âncora
// (completed_at v0.0.93 permanece intocado por este módulo). Se o dia
// calculado já está no passado, ele é CONSERVADO (não empurrado para hoje —
// a política de materialização/recuperação é outra fatia).
function nextAfterCompletion(rule, completedLocalDate, completedOrdinal) {
  var v = validateRule(rule)
  if (!v.ok) return { state: 'invalida', reason: v.errors[0] }

  if (rule.mode !== 'after_completion') {
    return { state: 'invalida', reason: _err('mode', "esperado 'after_completion'") }
  }

  // Ausência de instante NÃO é instante inválido: aguardando conclusão, sem
  // próxima data inventada (nunca now/updated/planned/relógio do cliente).
  if (
    completedLocalDate === undefined ||
    completedLocalDate === null ||
    completedLocalDate === ''
  ) {
    return { state: 'aguardando' }
  }
  if (typeof completedLocalDate !== 'string' || !isValidCivilDate(completedLocalDate)) {
    return {
      state: 'invalida',
      reason: _err(
        'completed_at',
        'instante inválido (esperado dia civil YYYY-MM-DD derivado de completed_at UTC)',
      ),
    }
  }
  if (!_isSafePositive(completedOrdinal)) {
    return {
      state: 'invalida',
      reason: _err('ordinal', 'ordinal inteiro positivo da ocorrência concluída'),
    }
  }

  var rep = rule.repeat
  var n = rep.interval
  var cy = parseInt(completedLocalDate.slice(0, 4), 10)
  var cm = parseInt(completedLocalDate.slice(5, 7), 10)
  var cd = parseInt(completedLocalDate.slice(8, 10), 10)

  var candDt
  if (rep.unit === 'day') {
    candDt = _makeUTC(cy, cm, cd)
    candDt.setUTCDate(candDt.getUTCDate() + n)
  } else if (rep.unit === 'week') {
    candDt = _makeUTC(cy, cm, cd)
    candDt.setUTCDate(candDt.getUTCDate() + n * 7)
  } else if (rep.unit === 'month') {
    // Componentes civis + último dia válido — NUNCA normalização que pule o mês.
    var total = cm - 1 + n
    var ny = cy + Math.floor(total / 12)
    var nm = (total % 12) + 1
    var nd = Math.min(cd, _daysInMonth(ny, nm))
    candDt = _makeUTC(ny, nm, nd)
  } else {
    var ny2 = cy + n
    var nd2 = Math.min(cd, _daysInMonth(ny2, cm))
    candDt = _makeUTC(ny2, cm, nd2)
  }

  var candStr = _fmt(candDt)

  // start_date limita o começo da regra: conclusão antecipada que produza dia
  // anterior ao começo é limitada ao começo e SINALIZADA — completed_at não é
  // alterado. Horário planejado segue o literal opcional da regra (não herda
  // hora/segundos da conclusão — aqui só dia civil é calculado).
  var adjustedToStart = false
  if (candStr < rule.start_date) {
    candStr = rule.start_date
    adjustedToStart = true
  }

  // Término aplicado ao PRÓXIMO ordinal.
  var nextOrdinal = completedOrdinal + 1
  if (rule.end.kind === 'count' && nextOrdinal > rule.end.count) {
    return { state: 'termino', reason: _err('end.count', 'contagem de ocorrências esgotada') }
  }
  if (rule.end.kind === 'date' && candStr > rule.end.date) {
    return {
      state: 'termino',
      reason: _err('end.date', 'próximo candidato além do término inclusivo'),
    }
  }

  // Datas no passado são conservadas (avaliação, não materialização).
  return {
    state: 'candidato',
    candidate: { date: candStr, ordinal: nextOrdinal, adjusted_to_start: adjustedToStart },
  }
}

module.exports = {
  // constantes
  MAX_PREVIEW: 5,
  MAX_PERIODS: RC_MAX_PERIODS,
  // validação pura
  isValidCivilDate: isValidCivilDate,
  isValidPlannedTime: isValidPlannedTime,
  validateRule: validateRule,
  // calendário fixo
  previewCalendar: previewCalendar,
  // após conclusão
  nextAfterCompletion: nextAfterCompletion,
}
