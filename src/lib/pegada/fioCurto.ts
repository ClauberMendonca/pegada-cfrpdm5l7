// PEGADA — a frase curta do fio, como no desenho da tela Hoje:
// "para ter X, porque Y." O servidor já devolve as peças; aqui só se monta a frase.
interface Fio {
  sem_fio?: boolean
  resultado?: { titulo: string } | null
  responsabilidade?: { titulo: string } | null
}

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function fioCurto(fio: Fio | null | undefined, proposito?: string | null): string {
  if (!fio || fio.sem_fio) return ''
  const alvo = fio.resultado
    ? `para ter ${minuscula(fio.resultado.titulo)}`
    : fio.responsabilidade
      ? `para sustentar ${minuscula(fio.responsabilidade.titulo)}`
      : ''
  if (!alvo) return ''
  const p = (proposito || '').trim().replace(/[.\s]+$/, '')
  return p ? `${alvo}, porque ${minuscula(p)}.` : `${alvo}.`
}
