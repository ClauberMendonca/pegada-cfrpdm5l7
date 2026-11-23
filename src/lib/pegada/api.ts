// PEGADA — cliente da API do método.
//
// Toda escrita do app passa por aqui (as coleções do núcleo não aceitam
// escrita direta desde a migration 0016). É a mesma API que agentes de IA
// usam pelo MCP: o que a tela faz, a API faz.
import { ClientResponseError } from 'pocketbase'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'

const BASE = '/backend/v1/pegada'

export type Origem = 'pessoa' | 'sugestao_ia'

export interface OpResponse<T = Record<string, unknown>> {
  ok: boolean
  operacao: string
  resultado?: T & { resumo?: string; aviso?: string }
  evento_id?: string | null
  proposta?: Proposta
  mensagem?: string
}

export interface Proposta {
  id: string
  agente_id: string | null
  operacao: string
  entrada: Record<string, unknown>
  resumo: string
  motivo: string
  status: 'pendente' | 'confirmada' | 'recusada' | 'falhou'
  erro: string | null
  criada_em: string
}

export interface EventoHistorico {
  id: string
  quem: 'pessoa' | 'ia_embutida' | 'agente'
  agente_id: string | null
  operacao: string
  resumo: string
  lote: string | null
  proposta_id: string | null
  desfaz: string | null
  desfeito_em: string | null
  quando: string
}

/** Erro de regra do método: traz o código (ex.: REGRA_DO_RASTRO). */
export class RegraError extends Error {
  regra: string
  constructor(message: string, regra: string) {
    super(message)
    this.regra = regra
  }
}

function toError(err: unknown): Error {
  if (err instanceof ClientResponseError) {
    const resp = err.response as { message?: string } | undefined
    const msg = resp?.message || err.message || `Falha (HTTP ${err.status}).`
    // O servidor prefixa a mensagem com o código da regra: "[REGRA_DO_RASTRO] ...".
    const m = msg.match(/^\[([A-Z_]+)\]\s*(.*)$/s)
    if (m) return new RegraError(m[2], m[1])
    return new Error(msg)
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function send<T>(path: string, body?: unknown, origem: Origem = 'pessoa'): Promise<T> {
  try {
    return await pb.send<T>(BASE + path, {
      method: 'POST',
      body: body ?? {},
      headers: origem === 'sugestao_ia' ? { 'X-Pegada-Origem': 'sugestao_ia' } : undefined,
    })
  } catch (err) {
    throw toError(err)
  }
}

export interface OpOptions {
  origem?: Origem
  /** Mostra um aviso com botão Desfazer (gestos de um toque). */
  desfazer?: boolean
  onDesfeito?: () => void
}

export async function op<T = Record<string, unknown>>(
  nome: string,
  entrada: Record<string, unknown> = {},
  opts: OpOptions = {},
): Promise<OpResponse<T>> {
  const res = await send<OpResponse<T>>(`/op/${nome}`, entrada, opts.origem)
  if (res.resultado?.aviso) toast.message(res.resultado.aviso)
  if (opts.desfazer && res.evento_id) {
    const eventId = res.evento_id
    toast(res.resultado?.resumo || 'Feito', {
      action: {
        label: 'Desfazer',
        onClick: () => {
          desfazer(eventId)
            .then(() => {
              toast.success('Desfeito')
              opts.onDesfeito?.()
            })
            .catch((e: Error) => toast.error(e.message))
        },
      },
    })
  }
  return res
}

export interface LoteItem {
  op: string
  entrada?: Record<string, unknown>
}

export async function lote(operacoes: LoteItem[], atomico = true, origem: Origem = 'pessoa') {
  return send<{ lote_id: string; atomico: boolean; resultados: OpResponse[] }>(
    '/lote',
    { operacoes, atomico },
    origem,
  )
}

export async function desfazer(eventoId: string) {
  return send<{ ok: boolean; resumo: string }>(`/desfazer/${eventoId}`)
}

export async function desfazerLote(loteId: string) {
  return send<{ ok: boolean; desfeitos: number }>(`/desfazer-lote/${loteId}`)
}

export async function decidirProposta(id: string, confirmar: boolean) {
  return send<{ ok: boolean; proposta: Proposta }>(
    `/propostas/${id}/${confirmar ? 'confirmar' : 'recusar'}`,
  )
}

export async function criarAgente(nome: string, escopos: string[], limitePorHora?: number) {
  return send<{
    ok: boolean
    token: string
    agente: { id: string; nome: string; escopos: string[]; prefixo: string }
  }>('/agentes', { nome, escopos, limite_por_hora: limitePorHora })
}

export async function revogarAgente(id: string) {
  return send<{ ok: boolean }>(`/agentes/${id}/revogar`)
}

/** Nível 1: pede uma sugestão à IA embutida (não grava nada). */
export async function sugerir(
  tipo: 'resultado' | 'avanco' | 'proposito' | 'captura',
  texto: string,
) {
  return send<{ tipo: string; sugestao: Record<string, string>; origem: string }>('/ia/sugerir', {
    tipo,
    texto,
  })
}

/** Endereço do servidor MCP deste app (para conectar agentes). */
export function mcpUrl(): string {
  const base = (import.meta.env.VITE_POCKETBASE_URL || window.location.origin).replace(/\/$/, '')
  return `${base}${BASE}/mcp`
}
