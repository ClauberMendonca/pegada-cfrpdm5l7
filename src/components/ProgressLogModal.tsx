import React, { useEffect, useId, useState } from 'react'
import { ActionItem, ProgressLogType } from '@/types/execution'
import { progressService, CreateProgressLogInput } from '@/services/progressService'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Check, ChevronDown, ChevronUp, Flame, Trophy } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { todayInZone, ownerTimezone, formatCalendarDay } from '@/lib/datetime'

interface ProgressLogModalProps {
  isOpen: boolean
  onClose: () => void
  action?: ActionItem | null
  projectId?: string
  onSaved?: () => void
}

// Dia-calendário real (YYYY-MM-DD): formato completo + existência no calendário
// (meses de 30/31 dias e anos bissextos). Sem deslocamento de fuso: usa UTC só
// como aritmética de calendário, sem converter o dia escolhido.
function isRealCalendarDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo - 1, d)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export const ProgressLogModal: React.FC<ProgressLogModalProps> = ({
  isOpen,
  onClose,
  action,
  projectId,
  onSaved,
}) => {
  const { toast } = useToast()
  const uid = useId()
  const dayPanelId = `${uid}-day-panel`
  const dayInputId = `${uid}-day-input`
  const dayHelpId = `${uid}-day-help`
  const dayErrorId = `${uid}-day-error`
  const [logType, setLogType] = useState<ProgressLogType>('executei')
  const [text, setText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [dayOpen, setDayOpen] = useState(false)
  // '' = sem escolha explícita (grava hoje no fuso do dono, sem enviar `date`).
  const [dayInput, setDayInput] = useState('')
  const [dayError, setDayError] = useState('')

  // Cada abertura do modal começa sem data retroativa herdada de outra sessão.
  // O texto digitado não é tocado aqui.
  useEffect(() => {
    if (isOpen) {
      setDayInput('')
      setDayOpen(false)
      setDayError('')
    }
  }, [isOpen])

  const finalProjectId = action?.project_id || projectId
  const timezone = ownerTimezone(pb.authStore.model?.timezone)
  const todayStr = todayInZone(timezone)
  const dayLabel = dayInput === '' || dayInput === todayStr ? 'Hoje' : formatCalendarDay(dayInput)

  const toggleDay = () => {
    // Recolher/expandir preserva a escolha; sem escolha, o campo apresenta hoje
    // (fuso do dono) sem gravar nada até o dono alterar a data.
    setDayOpen(!dayOpen)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    if (!text.trim()) return

    const chosenDay = dayInput.trim()
    if (chosenDay !== '' && !isRealCalendarDay(chosenDay)) {
      setDayOpen(true)
      setDayError('Data inválida. Escolha um dia que exista no calendário.')
      return
    }

    // Sem escolha explícita, a propriedade `date` é OMITIDA: o default do
    // serviço calcula hoje no fuso do dono no momento do envio.
    const payload: CreateProgressLogInput = {
      action_id: action?.id,
      project_id: finalProjectId,
      log_type: logType,
      text: text.trim(),
    }
    if (chosenDay !== '') payload.date = chosenDay

    setIsSaving(true)
    try {
      await progressService.create(payload)
      toast({
        title: 'Progresso registrado',
        description:
          logType === 'executei'
            ? 'Execução documentada com sucesso.'
            : 'Resultado factual documentado.',
      })
      setText('')
      setDayInput('')
      setDayError('')
      setDayOpen(false)
      onSaved?.()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar registro'
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: msg,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(680px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Registrar progresso
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Separe o esforço que você executou do resultado factual que aconteceu.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {action && (
            <div className="rounded-xl border border-border bg-muted p-3 text-sm text-foreground">
              <span className="mb-0.5 block font-medium text-muted-foreground">
                Vinculado à ação:
              </span>
              <span className="font-semibold text-foreground">{action.title}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Tipo de registro</Label>
            <RadioGroup
              value={logType}
              onValueChange={(val) => setLogType(val as ProgressLogType)}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors duration-150 ${
                  logType === 'executei'
                    ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="text-base font-semibold text-foreground">Executei</span>
                  </div>
                  <RadioGroupItem value="executei" className="sr-only" />
                </div>
                <span className="text-sm leading-snug text-muted-foreground">
                  Ato sob seu controle: fiz uma ligação, escrevi um rascunho, apliquei 25 min.
                </span>
              </label>

              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors duration-150 ${
                  logType === 'resultado_aconteceu'
                    ? 'border-ginga-info bg-ginga-info-bg text-ginga-info ring-1 ring-ginga-info'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-ginga-info" aria-hidden="true" />
                    <span className="text-base font-semibold text-foreground">
                      Resultado aconteceu
                    </span>
                  </div>
                  <RadioGroupItem value="resultado_aconteceu" className="sr-only" />
                </div>
                <span className="text-sm leading-snug text-muted-foreground">
                  Efeito factual do ambiente: contrato assinado, resposta recebida, métrica
                  atingida.
                </span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logText" className="text-sm font-medium text-foreground">
              O que aconteceu? (fato observável)
            </Label>
            <Textarea
              id="logText"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                logType === 'executei'
                  ? 'Ex: Concluí a redação preliminar da proposta e enviei para revisão...'
                  : 'Ex: O cliente aprovou o escopo sem alterações adicionais...'
              }
              className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
              required
            />
          </div>

          <div className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={toggleDay}
              aria-expanded={dayOpen}
              aria-controls={dayPanelId}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <span className="font-medium">
                Dia do fato: <span className="font-normal text-muted-foreground">{dayLabel}</span>
              </span>
              {dayOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {dayOpen && (
              <div id={dayPanelId} className="space-y-2 px-3 pb-3">
                <Label htmlFor={dayInputId} className="text-sm font-medium text-foreground">
                  Dia do fato
                </Label>
                <Input
                  id={dayInputId}
                  type="date"
                  value={dayInput === '' ? todayStr : dayInput}
                  onChange={(e) => {
                    setDayInput(e.target.value)
                    setDayError('')
                  }}
                  aria-describedby={dayError ? `${dayHelpId} ${dayErrorId}` : dayHelpId}
                  aria-invalid={dayError ? true : undefined}
                  className="min-h-11 border-input bg-card text-base text-foreground focus-visible:ring-ring sm:text-sm"
                />
                <p id={dayHelpId} className="text-sm leading-snug text-muted-foreground">
                  Quando este fato aconteceu; se não alterar, usamos hoje no seu fuso
                </p>
                {dayError && (
                  <p id={dayErrorId} role="alert" className="text-sm text-destructive">
                    {dayError}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-11 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !text.trim()}
              className="min-h-11 gap-1.5 rounded-xl"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {isSaving ? 'Salvando...' : 'Salvar registro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
