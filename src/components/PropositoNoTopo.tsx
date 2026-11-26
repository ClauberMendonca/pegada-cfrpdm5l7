// PEGADA — o propósito, sempre à vista no topo de cada tela, separado dos
// cartões. Assim nenhum cartão precisa repetir o porquê.
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PegadaSimbolo } from '@/components/PegadaSimbolo'
import { cn } from '@/lib/utils'

export function PropositoNoTopo() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const proposito = (user?.life_purpose ?? '').trim()
  // O Mapa já abre com o propósito em destaque; a tela do propósito é ele mesmo.
  if (pathname === '/mapa' || pathname === '/mapa/proposito') return null
  // Nas fichas, no computador, o Mapa ao lado já mostra o propósito.
  const ficha = pathname.startsWith('/mapa/')
  return (
    <Link
      to="/mapa/proposito"
      data-proposito-no-topo
      className={cn(
        'mb-5 flex min-h-11 items-center gap-2.5 border-b border-border pb-3 text-sm leading-snug text-muted-foreground hover:text-foreground',
        ficha && 'lg:hidden',
      )}
    >
      <PegadaSimbolo pequeno className="h-[18px] w-[18px] shrink-0 text-foreground" />
      <span className="min-w-0 break-words">
        {proposito || 'Escreva o seu propósito: é dele que nasce cada porquê.'}
      </span>
    </Link>
  )
}

export default PropositoNoTopo
