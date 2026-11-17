/**
 * NUMERAÇÃO PERMANENTE — apresentação (Resultados e Avanços).
 * Prefixos R-/AV- vêm SEMPRE do campo sequence_number gravado no banco
 * (migration 0009 + hooks). Nunca derivar de índice, COUNT, id ou created.
 * O prefixo é só apresentação: title, ids e URLs permanecem intactos.
 * Entidades persistem kind 'project'|'action'; a tela chama R = Resultado
 * (project) e AV = Avanço (action).
 */
export type EntityNumberKind = 'project' | 'action'

const PREFIX: Record<EntityNumberKind, string> = { project: 'R', action: 'AV' }
const KIND_LABEL: Record<EntityNumberKind, string> = { project: 'Resultado', action: 'Avanço' }
/** Prefixos legados aceitos na busca de cada catálogo (mesmo número). */
export const LEGACY_PREFIX: Record<EntityNumberKind, string> = { project: 'P', action: 'A' }

/** Número válido = inteiro positivo vindo do banco (sem zeros artificiais). */
export function hasEntityNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Código curto "R-3"/"AV-12"; null quando o número ainda não está disponível. */
export function entityNumberCode(
  kind: EntityNumberKind,
  n: number | null | undefined,
): string | null {
  return hasEntityNumber(n) ? `${PREFIX[kind]}-${n}` : null
}

/** Formatter textual para locais sem JSX: "R-1 · Título" (ou só o título). */
export function formatEntityTitle(
  kind: EntityNumberKind,
  n: number | null | undefined,
  title: string,
): string {
  const code = entityNumberCode(kind, n)
  return code ? `${code} · ${title}` : title
}

/** Nome acessível: "Resultado número 3" / "Avanço número 12". */
export function entityNumberAriaLabel(kind: EntityNumberKind, n: number): string {
  return `${KIND_LABEL[kind]} número ${n}`
}

// Falha de contrato: registro JÁ CARREGADO sem sequence_number. Reporta uma
// vez por entidade/sessão para não poluir o console em re-render.
const warnedMissing = new Set<string>()

export function reportMissingEntityNumber(kind: EntityNumberKind, entityId: string): void {
  const key = `${kind}:${entityId}`
  if (warnedMissing.has(key)) return
  warnedMissing.add(key)
  console.warn(
    `[ginga] ${KIND_LABEL[kind]} carregado (id ${entityId}) sem sequence_number — número indisponível na interface.`,
  )
}
