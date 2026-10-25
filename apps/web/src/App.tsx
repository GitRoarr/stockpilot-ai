import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { Layout, type Me } from './components/Layout';
import { Loading } from './components/ui';
import { useLive } from './hooks/useLive';
import { LoginPage } from './pages/Login';
import { OnboardingPage } from './pages/Onboarding';
import { TodayPage } from './pages/Today';
import { TeamPage } from './pages/Team';
import { TasksPage, TaskDetailPage } from './pages/Tasks';
import { InboxPage } from './pages/Inbox';
import { OrdersPage, OrderDetailPage } from './pages/Orders';
import { ReceivingPage, ReceivePage, InvoicePage } from './pages/Receiving';
import { DisputesPage, DisputeDetailPage } from './pages/Disputes';
import { InventoryPage } from './pages/Inventory';
import { SavingsPage } from './pages/Savings';
import { ActivityPage, RunDetailPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';

// Recharts is only needed on the Forecast page: load it on demand.
const ForecastPage = lazy(() => import('./pages/Forecast').then((m) => ({ default: m.ForecastPage })));

export function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), retry: false });
  const live = useLive(Boolean(me.data));

  useEffect(() => {
    const h = () => nav('/login');
    window.addEventListener('sp:unauthenticated', h);
    return () => window.removeEventListener('sp:unauthenticated', h);
  }, [nav]);

  if (loc.pathname === '/login') return <LoginPage />;
  if (me.isLoading) return <div className="p-8"><Loading /></div>;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!me.data.onboardingComplete && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if (loc.pathname === '/onboarding') return <OnboardingPage me={me.data} />;

  return (
    <Layout me={me.data} connected={live.connected}>
      <Routes>
        <Route path="/" element={<TodayPage me={me.data} />} />
        <Route path="/team" element={<TeamPage me={me.data} />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/inbox" element={<InboxPage me={me.data} />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage me={me.data} />} />
        <Route path="/receiving" element={<ReceivingPage />} />
        <Route path="/receiving/po/:id" element={<ReceivePage />} />
        <Route path="/receiving/invoices/:id" element={<InvoicePage me={me.data} />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/disputes/:id" element={<DisputeDetailPage me={me.data} />} />
        <Route path="/forecast" element={<Suspense fallback={<Loading />}><ForecastPage me={me.data} /></Suspense>} />
        <Route path="/inventory" element={<InventoryPage me={me.data} />} />
        <Route path="/savings" element={<SavingsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/activity/runs/:id" element={<RunDetailPage />} />
        <Route path="/settings" element={<SettingsPage me={me.data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
