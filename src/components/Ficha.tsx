// PEGADA — a ficha única: a mesma forma para os cinco elementos.
// Três zonas, na ordem da escada: o "para quê" em cima, o item no meio e o
// "como" embaixo. Subir e descer na tela é subir e descer na escada.
import { useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { Trilha, type Degrau } from '@/components/Trilha'
import { cn } from '@/lib/utils'

/** A aba do navegador mostra o nome do item aberto. */
export function useTituloDaAba(nome?: string | null) {
  useEffect(() => {
    if (!nome) return
    const antes = document.title
    document.title = `${nome} · Pegada`
    return () => {
      document.title = antes
    }
  }, [nome])
}

const ROTULO = 'text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground'

interface Props {
  /** Os degraus acima do item, do Mapa até o pai dele. */
  degraus: Degrau[]
  /** O nome do item, para a trilha e para a aba do navegador. */
  atual: string
  /** Zona de cima: a que este item serve. */
  paraQue: React.ReactNode
  /** Zona de baixo: como este item acontece. Sem ela, a ficha termina no item. */
  como?: React.ReactNode
  /** Zona do meio: o item. */
  children: React.ReactNode
  /** Quando o item já traz a própria moldura. */
  semMoldura?: boolean
}

export function Ficha({ degraus, atual, paraQue, como, children, semMoldura }: Props) {
  useTituloDaAba(atual)
  return (
    <article data-ficha className="flex min-w-0 flex-col gap-5">
      <Trilha degraus={degraus} atual={atual} />
      <section aria-label="Para quê" data-zona="para-que" className="rounded-2xl bg-secondary px-4 py-3">
        <p className={ROTULO}>Para quê</p>
        <div className="mt-1 text-[15px] leading-snug text-foreground">{paraQue}</div>
      </section>
      <section data-zona="item" className={cn(!semMoldura && 'rounded-2xl border border-border bg-card p-5')}>
        {children}
      </section>
      {como && (
        <section aria-label="Como" data-zona="como" className="flex flex-col gap-3">
          <p className={cn(ROTULO, 'px-1')}>Como</p>
          {como}
        </section>
      )}
    </article>
  )
}

/** Mostrar o mínimo, revelar o resto: um bloco que só abre quando pedem. */
export function Recolhido({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t border-border p-4">{children}</div>
    </details>
  )
}

/** Quando o endereço aponta para um item que não existe mais. */
export function FichaNaoEncontrada({ oQue }: { oQue: string }) {
  return (
    <div data-ficha className="flex flex-col gap-4">
      <Trilha degraus={[{ rotulo: 'Mapa', to: '/mapa' }]} atual="Não encontrado" />
      <div className="rounded-2xl border border-border bg-card p-5">
        <h1 className="text-xl font-semibold text-foreground">Não encontramos {oQue}</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Pode ter sido apagado, ou o endereço está incompleto. Volte ao Mapa pela seta, ou use a busca.
        </p>
      </div>
    </div>
  )
}

export default Ficha
