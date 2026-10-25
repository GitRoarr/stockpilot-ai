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

// Pages other than Today load on demand, so the first screen downloads only what it needs (Recharts only on Forecast).
const TeamPage = lazy(() => import('./pages/Team').then((m) => ({ default: m.TeamPage })));
const TasksPage = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.TasksPage })));
const TaskDetailPage = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.TaskDetailPage })));
const InboxPage = lazy(() => import('./pages/Inbox').then((m) => ({ default: m.InboxPage })));
const OrdersPage = lazy(() => import('./pages/Orders').then((m) => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import('./pages/Orders').then((m) => ({ default: m.OrderDetailPage })));
const ReceivingPage = lazy(() => import('./pages/Receiving').then((m) => ({ default: m.ReceivingPage })));
const ReceivePage = lazy(() => import('./pages/Receiving').then((m) => ({ default: m.ReceivePage })));
const InvoicePage = lazy(() => import('./pages/Receiving').then((m) => ({ default: m.InvoicePage })));
const DisputesPage = lazy(() => import('./pages/Disputes').then((m) => ({ default: m.DisputesPage })));
const DisputeDetailPage = lazy(() => import('./pages/Disputes').then((m) => ({ default: m.DisputeDetailPage })));
const InventoryPage = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.InventoryPage })));
const SavingsPage = lazy(() => import('./pages/Savings').then((m) => ({ default: m.SavingsPage })));
const ActivityPage = lazy(() => import('./pages/Activity').then((m) => ({ default: m.ActivityPage })));
const RunDetailPage = lazy(() => import('./pages/Activity').then((m) => ({ default: m.RunDetailPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
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
      <Suspense fallback={<Loading rows={4} />}>
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
        <Route path="/forecast" element={<ForecastPage me={me.data} />} />
        <Route path="/inventory" element={<InventoryPage me={me.data} />} />
        <Route path="/savings" element={<SavingsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/activity/runs/:id" element={<RunDetailPage />} />
        <Route path="/settings" element={<SettingsPage me={me.data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}
