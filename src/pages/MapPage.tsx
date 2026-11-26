// PEGADA — o Mapa e as fichas que moram nele.
// No celular, o Mapa ocupa a tela, e a ficha de um item abre por cima, com a
// seta de voltar. No computador, a ficha abre ao lado, e o Mapa continua à
// vista: a pessoa nunca perde de onde veio.
import { Outlet, useMatch } from 'react-router-dom'
import { ArvoreDoMapa } from '@/components/mapa/ArvoreDoMapa'
import { cn } from '@/lib/utils'

export function MapPage() {
  const soOMapa = Boolean(useMatch('/mapa'))
  return (
    <div className={cn(!soOMapa && 'lg:grid lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-8')}>
      <div
        className={cn(
          soOMapa
            ? ''
            : 'hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6.5rem)] lg:self-start lg:overflow-y-auto lg:pr-2',
        )}
      >
        <ArvoreDoMapa compacta={!soOMapa} />
      </div>
      {!soOMapa && (
        <div className="min-w-0">
          <Outlet />
        </div>
      )}
    </div>
  )
}

export default MapPage
