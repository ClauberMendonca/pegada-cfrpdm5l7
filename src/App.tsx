import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { FilterProvider } from '@/contexts/FilterContext'
import { TimeProvider } from '@/contexts/TimeContext'
import Layout from '@/components/Layout'
import { TodayPage } from '@/pages/TodayPage'
import { CapturesPage } from '@/pages/CapturesPage'
import { ActionsPage } from '@/pages/ActionsPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ResponsibilitiesPage } from '@/pages/ResponsibilitiesPage'
import { MapPage } from '@/pages/MapPage'
import { ReviewPage } from '@/pages/ReviewPage'
import SettingsPage from '@/pages/SettingsPage'
import { ActivityPage } from '@/pages/ActivityPage'
import { LoginPage } from '@/pages/LoginPage'
import NotFound from '@/pages/NotFound'

const ProtectedRoutes = () => {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Iniciando sistema...</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <FilterProvider>
      <TimeProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<TodayPage />} />
            <Route path="/capturas" element={<CapturesPage />} />
            {/* ENTREGA 1B — caminhos canônicos novos; /acoes e /projetos
                permanecem como aliases legados (nenhum redirect). */}
            <Route path="/avancos" element={<ActionsPage />} />
            <Route path="/resultados" element={<ProjectsPage />} />
            <Route path="/acoes" element={<ActionsPage />} />
            <Route path="/projetos" element={<ProjectsPage />} />
            {/* ENTREGA 3B — catálogo e ficha de Responsabilidades (mesmos
                providers/Layout; ficha retomável via ?id=). */}
            <Route path="/responsabilidades" element={<ResponsibilitiesPage />} />
            {/* PEGADA — histórico com desfazer, propostas de agentes e agentes. */}
            <Route path="/atividade" element={<ActivityPage />} />
            <Route path="/mapa" element={<MapPage />} />
            <Route path="/revisao" element={<ReviewPage />} />
            {/* ENTREGA 2A — Configurações do perfil (propósito de vida). */}
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </TimeProvider>
    </FilterProvider>
  )
}

const App = () => (
  <BrowserRouter>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <ProtectedRoutes />
      </AuthProvider>
    </TooltipProvider>
  </BrowserRouter>
)

export default App
