import React, { useState } from 'react'
import { ActionItem, ProgressLogType } from '@/types/execution'
import { progressService } from '@/services/progressService'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Check, Flame, Trophy } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ProgressLogModalProps {
  isOpen: boolean
  onClose: () => void
  action?: ActionItem | null
  projectId?: string
  onSaved?: () => void
}

export const ProgressLogModal: React.FC<ProgressLogModalProps> = ({
  isOpen,
  onClose,
  action,
  projectId,
  onSaved,
}) => {
  const { toast } = useToast()
  const [logType, setLogType] = useState<ProgressLogType>('executei')
  const [text, setText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const finalProjectId = action?.project_id || projectId

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return

    setIsSaving(true)
    try {
      await progressService.create({
        action_id: action?.id,
        project_id: finalProjectId,
        log_type: logType,
        text: text.trim(),
      })
      toast({
        title: 'Progresso registrado',
        description:
          logType === 'executei'
            ? 'Execução documentada com sucesso.'
            : 'Resultado factual documentado.',
      })
      setText('')
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
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-white">
            Registrar Progresso
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            A Inteligência Pragmática separa estritamente o esforço controlável que você executou do
            resultado final ou factual que aconteceu.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {action && (
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300">
              <span className="text-slate-500 block mb-0.5 font-medium">Vinculado à Ação:</span>
              <span className="font-semibold text-white">{action.title}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-slate-400">
              Tipo de Registro
            </Label>
            <RadioGroup
              value={logType}
              onValueChange={(val) => setLogType(val as ProgressLogType)}
              className="grid grid-cols-2 gap-3"
            >
              <label
                className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all ${
                  logType === 'executei'
                    ? 'bg-emerald-950/40 border-emerald-500/80 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-xs text-white">Executei</span>
                  </div>
                  <RadioGroupItem value="executei" className="sr-only" />
                </div>
                <span className="text-[11px] text-slate-400 leading-snug">
                  Ato sob seu controle: fiz uma ligação, escrevi um rascunho, apliquei 25 min.
                </span>
              </label>

              <label
                className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all ${
                  logType === 'resultado_aconteceu'
                    ? 'bg-sky-950/40 border-sky-500/80 text-sky-300 ring-1 ring-sky-500/30'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-sky-400" />
                    <span className="font-semibold text-xs text-white">Resultado Aconteceu</span>
                  </div>
                  <RadioGroupItem value="resultado_aconteceu" className="sr-only" />
                </div>
                <span className="text-[11px] text-slate-400 leading-snug">
                  Efeito factual do ambiente: contrato assinado, resposta recebida, métrica
                  atingida.
                </span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logText" className="text-xs uppercase tracking-wider text-slate-400">
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
              className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-emerald-500 text-sm"
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !text.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
            >
              <Check className="w-4 h-4" />
              {isSaving ? 'Salvando...' : 'Salvar Registro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
