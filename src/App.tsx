import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import OfficesPage from './pages/admin/OfficesPage';
import SizeCategoriesPage from './pages/admin/SizeCategoriesPage';
import CoursesPage from './pages/admin/CoursesPage';
import DriversPage from './pages/admin/DriversPage';
import DeliveriesPage from './pages/DeliveriesPage';
import MyDeliveriesPage from './pages/MyDeliveriesPage';
import ClosingPage from './pages/admin/ClosingPage';
import VehicleDaysPage from './pages/admin/VehicleDaysPage';
import ExpensesPage from './pages/admin/ExpensesPage';
import SettingsPage from './pages/admin/SettingsPage';
import ShiftsPage from './pages/admin/ShiftsPage';
import ShiftScheduleSettingsPage from './pages/admin/ShiftScheduleSettingsPage';
import ShiftPatternsPage from './pages/admin/ShiftPatternsPage';
import DayTypesPage from './pages/admin/DayTypesPage';
import SpecialDatesPage from './pages/admin/SpecialDatesPage';
import WorkItemsPage from './pages/admin/WorkItemsPage';
import WorkRecordsPage from './pages/WorkRecordsPage';
import IncidentsPage from './pages/IncidentsPage';
import CoursesMapPage from './pages/admin/CoursesMapPage';
import PagePermissionsPage from './pages/admin/PagePermissionsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 24 }}>読み込み中...</div>;
  if (!session) return <Navigate to="/login" replace />;
  // 初回ログインでパスワード未変更の場合は強制的に変更画面へ
  if (profile?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>読み込み中...</div>;
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="shifts" element={<ShiftsPage />} />
            <Route path="deliveries" element={<DeliveriesPage />} />
            <Route path="my-deliveries" element={<MyDeliveriesPage />} />
            <Route
              path="expenses"
              element={
                <RequireAdmin>
                  <ExpensesPage />
                </RequireAdmin>
              }
            />
            <Route
              path="closing"
              element={
                <RequireAdmin>
                  <ClosingPage />
                </RequireAdmin>
              }
            />
            <Route
              path="courses-map"
              element={
                <RequireAdmin>
                  <CoursesMapPage />
                </RequireAdmin>
              }
            />
            <Route path="work-records" element={<WorkRecordsPage />} />
            <Route path="incidents" element={<IncidentsPage />} />
            <Route
              path="settings"
              element={
                <RequireAdmin>
                  <SettingsPage />
                </RequireAdmin>
              }
            >
              <Route path="page-permissions" element={<PagePermissionsPage />} />
              <Route path="drivers" element={<DriversPage />} />
              <Route path="offices" element={<OfficesPage />} />
              <Route path="size-categories" element={<SizeCategoriesPage />} />
              <Route path="courses" element={<CoursesPage />} />
              <Route path="vehicle-days" element={<VehicleDaysPage />} />
              <Route path="day-types" element={<DayTypesPage />} />
              <Route path="special-dates" element={<SpecialDatesPage />} />
              <Route path="work-items" element={<WorkItemsPage />} />
              <Route path="shift-schedule" element={<ShiftScheduleSettingsPage />} />
              <Route path="shift-patterns" element={<ShiftPatternsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
