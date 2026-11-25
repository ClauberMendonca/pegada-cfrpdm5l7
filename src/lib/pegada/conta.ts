// PEGADA — cliente das rotas de conta: convites, pessoas, sessões e registro
// de acesso. O cadastro é fechado: conta só nasce de convite.
import { ClientResponseError } from 'pocketbase'
import pb from '@/lib/pocketbase/client'

const BASE = '/backend/v1/pegada/conta'

export interface Convite {
  id: string
  email: string
  situacao: 'pendente' | 'aceito' | 'cancelado' | 'vencido'
  vence_em: string
  criado_em: string
  aceito_em: string | null
}

export interface Pessoa {
  id: string
  nome: string
  email: string
  administra: boolean
  desativada: boolean
  criada_em: string
  ultimo_acesso: string | null
}

export interface Acesso {
  id: string
  quem?: string
  o_que: string
  detalhe: string
  ip: string
  navegador: string
  quando: string
}

export interface Uso {
  id: string
  nome: string
  dias_com_uso_7: number
  dias_com_uso_28: number
  operacoes_28: number
  com_ia_28: number
  por_agentes_28: number
  mais_usadas: { operacao: string; vezes: number }[]
}

/** Mensagem do servidor em português, ou uma frase padrão. */
export function mensagemDe(err: unknown, padrao = 'Não deu certo. Tente de novo.'): string {
  if (err instanceof ClientResponseError) {
    if (err.status === 429) return 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.'
    if (err.status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.'
    const resp = err.response as { message?: string; data?: Record<string, { message?: string }> }
    const campos = resp?.data ? Object.values(resp.data) : []
    const msg = resp?.message || ''
    // As mensagens próprias do Pegada já vêm em português; as nativas do
    // PocketBase vêm em inglês e viram a frase padrão.
    if (msg && !/^(Failed|Something|The request|An error|Invalid|Missing|You are not)/i.test(msg)) return msg
    if (campos.length && campos[0]?.message && !/^(Failed|Invalid|Missing|Cannot|Must|The )/i.test(campos[0].message))
      return campos[0].message
    return padrao
  }
  return err instanceof Error && err.message ? err.message : padrao
}

const get = <T>(path: string) => pb.send<T>(BASE + path, { method: 'GET' })
const post = <T>(path: string, body?: unknown) => pb.send<T>(BASE + path, { method: 'POST', body: body ?? {} })

export const conta = {
  config: () => get<{ email: boolean }>('/config'),
  verConvite: (token: string) => get<{ valido: boolean; email?: string; motivo?: string }>('/convite/' + token),
  aceitarConvite: (token: string, dados: { nome: string; senha: string; fuso: string; aceito_aviso: boolean }) =>
    post<{ ok: boolean; email: string }>('/convite/' + token + '/aceitar', dados),
  convites: () => get<{ convites: Convite[]; email: boolean }>('/convites'),
  convidar: (email: string) =>
    post<{ ok: boolean; convite: Convite; link: string; email_enviado: boolean }>('/convites', { email }),
  cancelarConvite: (id: string) => post<{ ok: boolean }>('/convites/' + id + '/cancelar'),
  pessoas: () => get<{ pessoas: Pessoa[] }>('/pessoas'),
  desativar: (id: string) => post<{ ok: boolean }>('/pessoas/' + id + '/desativar'),
  reativar: (id: string) => post<{ ok: boolean }>('/pessoas/' + id + '/reativar'),
  acessosDeTodos: () => get<{ acessos: Acesso[] }>('/acessos'),
  sairDeTodos: () => post<{ ok: boolean; token: string }>('/sair-de-todos'),
  exportar: () => get<Record<string, unknown>>('/exportar'),
  excluir: (senha: string, confirmo: string) => post<{ ok: boolean }>('/excluir', { senha, confirmo }),
  uso: () => get<{ janela_dias: number; uso: Uso[] }>('/uso'),
}

/** Os últimos acessos da própria pessoa (a coleção só mostra os dela). */
export async function meusAcessos(): Promise<Acesso[]> {
  const res = await pb.collection('access_events').getList(1, 20, { sort: '-created' })
  return res.items.map((x) => ({
    id: x.id,
    o_que: x.kind,
    detalhe: x.detail || '',
    ip: x.ip || '',
    navegador: x.agent || '',
    quando: x.created,
  }))
}

const NOMES: Record<string, string> = {
  entrada: 'Entrada',
  falha_entrada: 'Tentativa de entrada com senha errada',
  senha_trocada: 'Senha trocada',
  recuperacao_pedida: 'Pedido de nova senha',
  senha_redefinida: 'Senha redefinida pelo e-mail',
  email_trocado: 'E-mail trocado',
  conta_criada: 'Conta criada',
  convite_criado: 'Convite criado',
  convite_cancelado: 'Convite cancelado',
  conta_desativada: 'Conta desativada',
  conta_reativada: 'Conta reativada',
  sessoes_encerradas: 'Outras sessões encerradas',
  agente_criado: 'Agente de IA criado',
  agente_revogado: 'Agente de IA revogado',
  dados_exportados: 'Dados exportados',
  conta_excluida: 'Conta excluída',
}
export const nomeDoAcesso = (k: string) => NOMES[k] || k

/** "Chrome no Windows", a partir do cabeçalho do navegador. */
export function navegadorCurto(ua: string): string {
  if (!ua) return ''
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  const so = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  if (nav && so) return `${nav} no ${so}`
  return nav || so || 'Outro aplicativo'
}

/** Data e hora curtas no fuso do aparelho. */
export function quandoCurto(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** A regra de senha do servidor, repetida aqui para avisar antes de enviar. */
export function senhaCurta(senha: string): string {
  return senha.length < 10 ? 'Use pelo menos 10 caracteres. Uma frase curta funciona bem.' : ''
}
