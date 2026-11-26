// PEGADA — o Propósito, no topo do Mapa (/mapa/proposito).
// É o degrau mais alto da escada: abaixo dele vêm as responsabilidades e os
// resultados. A escrita passa pela API do método (definir_proposito), com
// histórico e desfazer. A IA ajuda a formular, mas nunca inventa.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, Check, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { GuiaDoProposito } from '@/components/GuiaDoProposito'
import { Trilha } from '@/components/Trilha'
import { cn } from '@/lib/utils'

const MAX = 500

export function PropositoPage() {
  const { user, updateLifePurpose } = useAuth()
  const salvo = (user?.life_purpose ?? '') as string
  const [texto, setTexto] = useState(salvo)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [acabouDeSalvar, setAcabouDeSalvar] = useState(false)

  // Outra aba ou um agente pode ter mudado o propósito: acompanha o perfil
  // enquanto a pessoa não começou a editar.
  useEffect(() => {
    setTexto((atual) => (atual === '' || atual === salvo ? salvo : atual))
  }, [salvo])

  const mudou = texto.trim() !== salvo.trim()

  const salvar = async () => {
    if (salvando || !mudou) return
    setSalvando(true)
    setErro(null)
    try {
      await updateLifePurpose(texto.trim())
      setAcabouDeSalvar(true)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o propósito. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  if (!user) return null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Trilha degraus={[{ rotulo: 'Mapa', to: '/mapa' }]} atual="Propósito" />

      <div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-foreground">Propósito</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          A razão permanente pela qual você age. Nunca se conclui e não tem prazo.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
        className="space-y-4"
      >
        <div className="rounded-[20px] p-5" style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}>
          <label
            htmlFor="proposito"
            className="text-xs uppercase tracking-[0.08em]"
            style={{ color: 'var(--pegada-on-ink-muted)' }}
          >
            Eu existo para…
          </label>
          <textarea
            id="proposito"
            value={texto}
            maxLength={MAX}
            disabled={salvando}
            onChange={(e) => {
              setTexto(e.target.value)
              setAcabouDeSalvar(false)
            }}
            placeholder="Eu existo para [verbo] [quem ou o quê], para que [mudança]."
            rows={3}
            className="mt-2 w-full resize-y bg-transparent text-[19px] font-semibold leading-snug placeholder:font-normal placeholder:opacity-60 focus-visible:outline-none"
            style={{ color: 'var(--pegada-on-ink)' }}
          />
        </div>

        {erro && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={salvando || !mudou}
            className={cn(
              'flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors duration-200 hover:bg-[var(--pegada-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            )}
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          {acabouDeSalvar && !mudou && (
            <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Check className="h-4 w-4" aria-hidden="true" />
              Propósito salvo
            </p>
          )}
        </div>

        <GuiaDoProposito
          onUsar={(frase) => {
            setTexto(frase.slice(0, MAX))
            setAcabouDeSalvar(false)
          }}
        />
      </form>

      <Link
        to="/mapa"
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-foreground hover:bg-secondary"
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
        Como? Ver o Mapa
      </Link>
    </div>
  )
}

export default PropositoPage
