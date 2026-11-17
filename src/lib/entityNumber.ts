/**
 * NUMERAÇÃO PERMANENTE — Entrega 2 (apresentação).
 * Prefixos P-/A- vêm SEMPRE do campo sequence_number gravado no banco
 * (migration 0009 + hooks). Nunca derivar de índice, COUNT, id ou created.
 * O prefixo é só apresentação: title, ids e URLs permanecem intactos.
 */
export type EntityNumberKind = 'project' | 'action'

const PREFIX: Record<EntityNumberKind, string> = { project: 'P', action: 'A' }
const KIND_LABEL: Record<EntityNumberKind, string> = { project: 'Projeto', action: 'Ação' }

/** Número válido = inteiro positivo vindo do banco (sem zeros artificiais). */
export function hasEntityNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Código curto "P-3"/"A-12"; null quando o número ainda não está disponível. */
export function entityNumberCode(
  kind: EntityNumberKind,
  n: number | null | undefined,
): string | null {
  return hasEntityNumber(n) ? `${PREFIX[kind]}-${n}` : null
}

/** Formatter textual para locais sem JSX: "P-1 · Título" (ou só o título). */
export function formatEntityTitle(
  kind: EntityNumberKind,
  n: number | null | undefined,
  title: string,
): string {
  const code = entityNumberCode(kind, n)
  return code ? `${code} · ${title}` : title
}

/** Nome acessível: "Projeto número 3" / "Ação número 12". */
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
