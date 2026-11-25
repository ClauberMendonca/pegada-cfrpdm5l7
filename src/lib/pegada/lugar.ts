// PEGADA — onde a pessoa está. Toda tela pertence a um dos quatro destinos
// (ou à conta), para o menu ficar sempre aceso e a aba do navegador dizer o
// nome do lugar. Fonte única: o menu, o título da aba e a busca usam isto.

export type Destino = 'hoje' | 'mapa' | 'caixa' | 'revisao' | 'conta'

export interface Lugar {
  destino: Destino
  titulo: string
}

const LUGARES: { prefixo: string; lugar: Lugar }[] = [
  { prefixo: '/mapa/proposito', lugar: { destino: 'mapa', titulo: 'Propósito' } },
  { prefixo: '/mapa', lugar: { destino: 'mapa', titulo: 'Mapa' } },
  { prefixo: '/caixa', lugar: { destino: 'caixa', titulo: 'Caixa' } },
  { prefixo: '/revisao', lugar: { destino: 'revisao', titulo: 'Revisão' } },
  { prefixo: '/historico', lugar: { destino: 'conta', titulo: 'Histórico' } },
  { prefixo: '/configuracoes', lugar: { destino: 'conta', titulo: 'Configurações' } },
]

export function lugarDe(pathname: string): Lugar {
  if (pathname === '/' || pathname === '') return { destino: 'hoje', titulo: 'Hoje' }
  const achado = LUGARES.find((l) => pathname === l.prefixo || pathname.startsWith(l.prefixo + '/'))
  return achado ? achado.lugar : { destino: 'conta', titulo: 'Pegada' }
}

/** True quando a tecla foi digitada num campo: atalhos de uma letra não disparam. */
export function digitandoEmCampo(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
