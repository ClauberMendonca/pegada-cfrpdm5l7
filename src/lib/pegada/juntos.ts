// PEGADA — trabalhar junto: resultado compartilhado, delegação e avisos.
//
// O método continua sendo de cada pessoa. Só o Resultado e o que está abaixo
// dele (estratégias e avanços) se compartilha; o porquê de cada um é pessoal.
import pb from '@/lib/pocketbase/client'
import { op } from '@/lib/pegada/api'

export interface Pessoa {
  id: string
  nome: string
  foto: string
  email?: string
  eu?: boolean
}

export interface Participante extends Pessoa {
  papel: 'criou' | 'participa' | 'convidado'
  vinculo_id: string | null
  avancos_abertos: number
  avancos_feitos: number
}

export interface Participantes {
  resultado_id: string
  sou_dono: boolean
  pessoas: Participante[]
  meu_porque: { responsabilidade_id: string | null; vontade_id: string | null } | null
}

export interface Convite {
  id: string
  resultado: { id: string; titulo: string; prazo: string; como_sei: string } | null
  de: Pessoa
  quando: string
}

export interface Aviso {
  id: string
  tipo: string
  texto: string
  de: string
  resultado_id: string | null
  avanco_id: string | null
  convite_id: string | null
  lido: boolean
  quando: string
}

export interface AvancoJunto {
  id: string
  meu: boolean
  compartilhado: boolean
  responsavel: Pessoa
  passado_por: Pessoa | null
  pode_passar: boolean
  pode_devolver: boolean
  pessoas: Pessoa[]
  fio: { frase: string; sem_fio: boolean }
}

export interface EventoDoResultado {
  id: string
  pessoa: string
  meu: boolean
  operacao: string
  resumo: string
  quando: string
}

type Porque = { responsabilidade_id?: string; vontade_id?: string }

const r = async <T>(nome: string, entrada: Record<string, unknown> = {}) =>
  (await op<T>(nome, entrada)).resultado as T

export const juntos = {
  participantes: (resultadoId: string) => r<Participantes>('ver_participantes', { resultado_id: resultadoId }),
  convidar: (resultadoId: string, quem: { email?: string; pessoa_id?: string }) =>
    r<{ pessoa: Pessoa }>('compartilhar_resultado', { resultado_id: resultadoId, ...quem }),
  tirar: (resultadoId: string, pessoaId: string) =>
    r('remover_participante', { resultado_id: resultadoId, pessoa_id: pessoaId }),
  sair: (resultadoId: string) => r('sair_do_resultado', { resultado_id: resultadoId }),
  meuPorque: (resultadoId: string, porque: Porque) =>
    r('ligar_resultado_compartilhado', {
      resultado_id: resultadoId,
      responsabilidade_id: porque.responsabilidade_id ?? '',
      vontade_id: porque.vontade_id ?? '',
    }),
  conhecidas: async () => (await r<{ pessoas: Pessoa[] }>('pessoas_conhecidas')).pessoas,
  responder: (conviteId: string, aceitar: boolean, porque: Porque = {}) =>
    r<{ aceito: boolean; resultado_id?: string }>('responder_convite', {
      convite_id: conviteId,
      aceitar,
      ...porque,
    }),
  avisos: () => r<{ avisos: Aviso[]; novos: number; convites: Convite[] }>('listar_avisos'),
  marcarLidos: () => r('marcar_avisos_lidos'),
  avanco: (id: string) => r<AvancoJunto>('ver_avanco', { avanco_id: id }),
  passar: (avancoId: string, pessoaId: string) =>
    r('passar_avanco', { avanco_id: avancoId, pessoa_id: pessoaId }),
  devolver: (avancoId: string, motivo: string) =>
    r('devolver_avanco', { avanco_id: avancoId, motivo: motivo || undefined }),
  historico: async (resultadoId: string) =>
    (await r<{ eventos: EventoDoResultado[] }>('ver_historico', { resultado_id: resultadoId, limite: 40 })).eventos,
}

/** Endereço da foto de uma pessoa, ou '' quando não há. */
export function fotoDe(p: { id: string; foto?: string }): string {
  if (!p.foto) return ''
  return `${pb.baseURL.replace(/\/$/, '')}/api/files/_pb_users_auth_/${p.id}/${encodeURIComponent(p.foto)}?thumb=100x100`
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome

/** Avisa quem mostra o sino que algo mudou. */
export const avisosMudaram = () => window.dispatchEvent(new Event('pegada:avisos'))
