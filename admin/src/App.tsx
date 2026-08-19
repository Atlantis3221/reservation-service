import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="loading-screen">Загрузка...</div>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="loading-screen">Загрузка...</div>;
  if (token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Пока нет ни одного заведения, показываем онбординг, а не пустую панель */
function Home() {
  const { businesses } = useAuth();
  return businesses.length === 0 ? <OnboardingPage /> : <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/forgot" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
