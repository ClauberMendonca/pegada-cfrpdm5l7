import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ActionItem, Project } from "@/types/execution";
import { projectService } from "@/services/projectService";
import { actionService } from "@/services/actionService";
import { useGlobalFilter } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Compass,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Inbox,
  Loader2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ownerTimezone, todayInZone } from "@/lib/datetime";
import {
  ListRow,
  projectSummaryLine,
  SummaryToggle,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from "@/components/ViewToggle";
import { EntityNumberBadge } from "@/components/EntityNumberBadge";
import { formatEntityTitle } from "@/lib/entityNumber";
import { GuidedReview } from "@/components/GuidedReview";
import { OQueReavaliar } from "@/components/OQueReavaliar";
import { SuaSemana } from "@/components/FioESemana";

/**
 * BLOCO 3 — Revisão acionável.
 * - Estados distintos: carregando / falha com "Tentar novamente" / vazio real.
 *   Nenhum contador aparece como diagnóstico durante carga ou falha.
 * - O contador sinaliza projetos ativos sem ação "pronta" OU "em andamento"
 *   (rótulo alinhado ao cálculo real, não "ausência de próximo avanço").
 * - Diagnóstico rotulado como "Estado atual" com data de referência no fuso
 *   do dono — os números não são apresentados como mudança da semana.
 * - Coleção real de projetos sinalizados reaproveita Cards/Lista (preferência
 *   por dono, área 'revisao'); perguntas e contadores não recebem o seletor.
 */
export const ReviewPage: React.FC = () => {
  const { contextFilter } = useGlobalFilter();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // BLOCO 3(e) — Cards/Lista só na coleção real de projetos sinalizados.
  const [view, setView] = useViewPreference("revisao", user?.id);
  const [showSummary, setShowSummary] = useSummaryPreference(
    "revisao",
    user?.id,
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const filterContext =
        contextFilter === "todos" ? undefined : contextFilter;
      const [projs, acts] = await Promise.all([
        projectService.list(filterContext),
        actionService.list(filterContext),
      ]);
      setProjects(projs);
      setActions(acts);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Erro ao carregar dados. Verifique sua conexão e tente novamente.";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [contextFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData, reloadNonce]);

  const retry = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  // BLOCO 3(b) — cálculo real: pronta OU em andamento conta como avanço definido.
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "ativo"),
    [projects],
  );
  const pausedProjects = useMemo(
    () => projects.filter((p) => p.status === "pausado"),
    [projects],
  );

  const flaggedProjects = useMemo(() => {
    if (isLoading || loadError) return [];
    return activeProjects.filter((p) => {
      const projActions = actions.filter((a) => a.project_id === p.id);
      return !projActions.some(
        (a) => a.status === "pronta" || a.status === "em_andamento",
      );
    });
  }, [activeProjects, actions, isLoading, loadError]);

  // BLOCO 3(d) — "Estado atual" com data de referência no fuso do dono.
  const referenceDate = todayInZone(ownerTimezone(user?.timezone));

  const openProjectSheet = useCallback(
    (id: string) => {
      // BLOCO 2A — mesmo contrato de URL do catálogo (/projetos?id=<ID>) com a
      // origem declarada; a ficha usa esse estado para retornar a /revisao.
      navigate(`/mapa/resultado/${encodeURIComponent(id)}`, {
        state: { from: "review" },
      });
    },
    [navigate],
  );

  const hasData = !isLoading && !loadError;
  const emptyReal = hasData && projects.length === 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Compass className="w-6 h-6 text-primary" />
            Revisão
          </h2>
        </div>

        {contextFilter !== "todos" && (
          <Badge
            variant="outline"
            className={`text-xs uppercase font-medium ${
              contextFilter === "trabalho"
                ? "border-pegada-info/30 text-pegada-info bg-pegada-info-bg"
                : "border-pegada-warning/30 text-pegada-warning bg-pegada-warning-bg"
            }`}
          >
            Filtro: {contextFilter}
          </Badge>
        )}
      </div>

      {/* PEGADA — Revisão guiada, passo a passo, sobre ver_resumo_semana */}
      <GuidedReview onChanged={retry} />

      {!isLoading && !loadError && (
        <>
          <SuaSemana
            actions={actions}
            hoje={referenceDate}
            timezone={ownerTimezone(user?.timezone)}
          />
          <OQueReavaliar actions={actions} hoje={referenceDate} />
        </>
      )}

      {/* BLOCO 3(a) — carregando */}
      {isLoading && (
        <div className="rounded-xl border border-border bg-muted p-6 flex items-center gap-3">
          <Loader2
            className="h-5 w-5 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground font-medium">
            Carregando o estado atual dos resultados…
          </p>
        </div>
      )}

      {/* BLOCO 3(a) — falha com tentativa explícita; zeros não aparecem */}
      {loadError && !isLoading && (
        <div className="rounded-xl border border-destructive/30 bg-pegada-danger-bg p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">
              Falha ao carregar a Revisão.
            </p>
            <p className="text-xs text-destructive mt-0.5">{loadError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={retry}
              className="mt-2 gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {/* BLOCO 3(a) — vazio real: nenhuma base de projetos ainda */}
      {emptyReal && (
        <Card className="bg-card border-border text-card-foreground">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center text-muted-foreground mb-2">
              <Inbox className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl font-bold text-foreground">
              Nenhum resultado cadastrado ainda
            </CardTitle>
            <CardDescription className="text-muted-foreground max-w-xl mx-auto text-sm">
              O diagnóstico desta área aparece quando existem resultados. Comece
              criando o seu primeiro resultado no Mapa.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pt-2">
            <Button asChild variant="outline" className="gap-2">
              <Link to="/mapa">
                <span>Abrir o Mapa</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {hasData && !emptyReal && (
        <details>
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted-foreground underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            Ver o retrato de agora
          </summary>
          <Card className="bg-card border-border text-card-foreground">
            <CardContent className="space-y-6 pt-4">
              {/* BLOCO 3(d) — Estado atual com data de referência no fuso do dono */}
              <p className="text-xs text-muted-foreground text-center">
                <span className="font-semibold uppercase tracking-wider text-foreground">
                  Estado atual
                </span>{" "}
                — data de referência: {referenceDate}
              </p>

              {/* Diagnóstico atual (nunca durante carga/falha — ver estados acima) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-muted border border-border">
                  <span className="text-xs text-muted-foreground block font-medium">
                    Resultados Ativos
                  </span>
                  <span className="text-2xl font-bold text-foreground mt-1 block">
                    {activeProjects.length}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Frentes em andamento simultâneo
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-pegada-warning-bg border border-pegada-warning/30">
                  <span className="text-xs text-pegada-warning block font-medium">
                    Ativos sem Avanço Pronto ou em Andamento
                  </span>
                  <span className="text-2xl font-bold text-pegada-warning mt-1 block">
                    {flaggedProjects.length}
                  </span>
                  <span className="text-[11px] text-pegada-warning/80">
                    Resultados sem nenhum avanço “pronto” nem “em andamento” —
                    necessitam de desdobramento
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-muted border border-border">
                  <span className="text-xs text-muted-foreground block font-medium">
                    Resultados Pausados
                  </span>
                  <span className="text-2xl font-bold text-foreground mt-1 block">
                    {pausedProjects.length}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Preservados sem pressão de entrega
                  </span>
                </div>
              </div>

              {/* BLOCO 3(c)+(e) — coleção real de projetos sinalizados, com Cards/Lista */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-pegada-warning flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    Resultados sinalizados ({flaggedProjects.length})
                  </h4>
                  <ViewToggle
                    view={view}
                    onChange={setView}
                    className="shrink-0"
                  />
                  {view === "list" && (
                    <SummaryToggle
                      checked={showSummary}
                      onChange={setShowSummary}
                    />
                  )}
                </div>

                {flaggedProjects.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-muted p-4 text-center text-xs text-muted-foreground">
                    Nenhum resultado ativo sinalizado agora: todos têm avanço
                    “pronto” ou “em andamento”.
                  </p>
                ) : view === "cards" ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {flaggedProjects.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-xl border border-border bg-card p-3 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          {/* NUMERAÇÃO PERMANENTE — selo R-N do banco antes do título */}
                          <span className="mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                            <EntityNumberBadge
                              kind="project"
                              n={p.sequence_number}
                              entityId={p.id}
                            />
                            <span className="min-w-0 text-sm font-medium text-foreground break-words">
                              {p.title}
                            </span>
                          </span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {p.context === "trabalho" ? "Trabalho" : "Vida"} ·
                            sem avanço pronto ou em andamento
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openProjectSheet(p.id)}
                          className="shrink-0 gap-1.5 min-h-11"
                        >
                          <ExternalLink
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Abrir ficha
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {flaggedProjects.map((p) => (
                      <ListRow
                        key={p.id}
                        title={p.title}
                        open={false}
                        onToggle={() => openProjectSheet(p.id)}
                        hint="Abrir ficha ›"
                        summary={
                          showSummary
                            ? [
                                // NUMERAÇÃO PERMANENTE — código R-N real primeiro
                                formatEntityTitle(
                                  "project",
                                  p.sequence_number,
                                  p.title,
                                ),
                                projectSummaryLine(p) || undefined,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : undefined
                        }
                        numberKind="project"
                        numberValue={p.sequence_number}
                        numberEntityId={p.id}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Checklist de Reflexão (perguntas NÃO recebem o seletor Cards/Lista) */}
              <div className="p-5 rounded-2xl bg-muted border border-border space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-pegada-success" />
                  Perguntas-Chave para o Fechamento Semanal
                </h4>

                <div className="space-y-3 text-xs sm:text-sm text-foreground">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                      1
                    </span>
                    <div>
                      <strong>A entrega controlável ainda faz sentido?</strong>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Avalie se o que você se comprometeu a entregar
                        diretamente ainda é a alavanca certa para a aspiração
                        desejada.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                      2
                    </span>
                    <div>
                      <strong>
                        Existe algum resultado estagnado sem próximo passo?
                      </strong>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Se um resultado ativo não possui nenhum avanço “pronto”
                        nem “em andamento”, defina o próximo avanço
                        imediatamente ou pause-o formalmente.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                      3
                    </span>
                    <div>
                      <strong>
                        Os aprendizados e ativos duráveis foram registrados?
                      </strong>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Mesmo que o resultado de mercado não tenha vindo,
                        documente o que você construiu como ativo intelectual ou
                        operacional.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/mapa">
                    <span>Abrir o Mapa e ajustar os resultados</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </details>
      )}
    </div>
  );
};
