// PEGADA — o endereço de cada ficha. Todo item mora no Mapa, então toda ficha
// fica embaixo de /mapa. Fonte única: links, busca e redirecionamentos usam isto.

export type Degrau = 'vontade' | 'responsabilidade' | 'resultado' | 'avanco'

export function fichaDe(degrau: Degrau, id: string): string {
  return `/mapa/${degrau}/${encodeURIComponent(id)}`
}

export const fichaDoResultado = (id: string) => fichaDe('resultado', id)
export const fichaDaVontade = (id: string) => fichaDe('vontade', id)
export const fichaDaResponsabilidade = (id: string) => fichaDe('responsabilidade', id)
export const fichaDoAvanco = (id: string) => fichaDe('avanco', id)
