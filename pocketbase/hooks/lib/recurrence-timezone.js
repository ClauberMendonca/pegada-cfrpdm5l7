/**
 * FATIA 6A2 — RECORRÊNCIA: ADAPTADOR TEMPORAL NATIVO (fuso)
 *
 * CommonJS para a JSVM (goja) do PocketBase. NÃO é *.pb.js — nada é registrado
 * automaticamente; o consumidor FUTURO fará
 * `require(__hooks + '/lib/recurrence-timezone.js')` DENTRO do callback.
 *
 * Reutiliza o critério da guarda 5A (planned-execution-guards.pb.js):
 * - new Timezone(nome) pode devolver UTC silenciosamente para nome inválido —
 *   construir sem exceção NÃO valida; confere zone.string() === entrada.
 * - 'UTC' explícito é válido; 'Local'/vazio/offset numérico são rejeitados.
 * - Se a JSVM não tiver Timezone/DateTime, falha EXPLÍCITA (não-troca por
 *   UTC/aritmética de offset).
 *
 * Caminho documentado (contrato local, conferido nas fontes públicas):
 *   new DateTime(instantUtc).time().in(zone).format('2006-01-02')
 * DateTime representa instante UTC; Time.in interpreta o MESMO instante na
 * localização; format produz o dia civil. O instantUtc é parseado com
 * $appNewDateTime? NÃO — o parse é do próprio DateTime global da JSVM, que
 * aceita string RFC3339; parse e isZero são conferidos ANTES de converter.
 *
 * Limites desta fatia: sem $app, sem banco, sem HTTP, sem perfil, sem estado
 * mutável. NÃO converte data/hora planejadas em instante UTC (transformação
 * inversa, ambiguidade de horário de verão e notificações ficam fora).
 */

'use strict'

// Motivos: 'empty' | 'local' | 'numeric_offset' | 'unavailable' | 'not_found'
function validateTimezoneName(tz) {
  if (typeof tz !== 'string' || tz.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  if (tz !== tz.trim() || tz.trim() === '') {
    return { ok: false, reason: 'empty' }
  }
  if (tz === 'Local') {
    return { ok: false, reason: 'local' }
  }
  // Nomes IANA nunca contêm offset numérico/sinal (ex.: +03:00).
  if (/[+]/.test(tz) || /^-/.test(tz) || /^-?[0-9]/.test(tz)) {
    return { ok: false, reason: 'numeric_offset' }
  }
  return { ok: true }
}

// Existência/nome nativo: UTC explícito ok; demais nomes precisam corresponder
// ao retornado por zone.string(). Não troca por UTC se falhar.
function resolveTimezone(tz) {
  var check = validateTimezoneName(tz)
  if (!check.ok) return { ok: false, reason: check.reason }

  if (typeof Timezone !== 'function' || !Timezone) {
    return { ok: false, reason: 'unavailable' }
  }
  if (tz === 'UTC') {
    return { ok: true, zone: new Timezone('UTC') }
  }

  // Guarda de disponibilidade igual à 5A: UTC precisa existir e ter string().
  var utcProbe
  try {
    utcProbe = new Timezone('UTC')
  } catch (_e) {
    return { ok: false, reason: 'unavailable' }
  }
  if (!utcProbe || !utcProbe.string) {
    return { ok: false, reason: 'unavailable' }
  }

  var zone
  try {
    zone = new Timezone(tz)
  } catch (_e2) {
    return { ok: false, reason: 'not_found' }
  }
  if (!zone || typeof zone.string !== 'function' || zone.string() !== tz) {
    return { ok: false, reason: 'not_found' }
  }
  return { ok: true, zone: zone }
}

// completed_at é o instante UTC EXPLÍCITO (string RFC3339 do registro). NUNCA
// chamar new DateTime() sem argumento (produziria "agora"): a ausência é
// decidida por quem chama (estado 'aguardando'), e aqui a presença é exigida.
// Parse e isZero conferidos ANTES de converter; nunca cortar o timestamp UTC
// antes de aplicar o fuso. Devolve o dia civil 'YYYY-MM-DD' no fuso.
function civilDateFromCompletedAt(instantUtc, tz) {
  var check = validateTimezoneName(tz)
  if (!check.ok) {
    return { ok: false, reason: 'timezone_' + check.reason }
  }
  if (typeof instantUtc !== 'string' || instantUtc.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  // Instante deve ser UTC explícito (Z ou offset que resolva para UTC — o
  // backend persiste RFC3339 com Z). Sem UTC explícito, não converte.
  if (!/[zZ]$/.test(instantUtc) && !/[+-]\d{2}:\d{2}$/.test(instantUtc)) {
    return { ok: false, reason: 'not_utc' }
  }

  if (typeof DateTime !== 'function' || !DateTime) {
    return { ok: false, reason: 'unavailable' }
  }

  var dt
  try {
    dt = new DateTime(instantUtc)
  } catch (_e) {
    return { ok: false, reason: 'invalid_instant' }
  }
  if (!dt || !dt.time || typeof dt.time !== 'function') {
    return { ok: false, reason: 'invalid_instant' }
  }
  var t = dt.time()
  if (!t || typeof t.isZero !== 'function') {
    return { ok: false, reason: 'invalid_instant' }
  }
  if (t.isZero()) {
    // Parse falhou silenciosamente (Go time.Time zero) — não é 0001-01-01.
    return { ok: false, reason: 'invalid_instant' }
  }

  var zoneResult = resolveTimezone(tz)
  if (!zoneResult.ok) return { ok: false, reason: 'timezone_' + zoneResult.reason }

  try {
    var civil = t.in(zoneResult.zone).format('2006-01-02')
    if (typeof civil !== 'string' || civil.length !== 10) {
      return { ok: false, reason: 'invalid_instant' }
    }
    return { ok: true, date: civil }
  } catch (_e2) {
    return { ok: false, reason: 'invalid_instant' }
  }
}

module.exports = {
  validateTimezoneName: validateTimezoneName,
  resolveTimezone: resolveTimezone,
  civilDateFromCompletedAt: civilDateFromCompletedAt,
}
