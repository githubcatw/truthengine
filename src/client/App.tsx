import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider, useI18n } from './i18n';
import { AppLayout } from './components/Layout';
import { Skeleton } from './components/ui';
import type { Role } from '../shared/schemas';

const Landing = lazy(() => import('./pages/Landing'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const NewVerification = lazy(() => import('./pages/NewVerification'));
const Investigation = lazy(() => import('./pages/Investigation'));
const Results = lazy(() => import('./pages/Results'));
const History = lazy(() => import('./pages/History'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const LearningCenter = lazy(() => import('./pages/LearningCenter'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const Classrooms = lazy(() => import('./pages/Classrooms'));
const ClassroomDetail = lazy(() => import('./pages/ClassroomDetail'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const TrustedSources = lazy(() => import('./pages/TrustedSources'));
const Receipts = lazy(() => import('./pages/Receipts'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Admin = lazy(() => import('./pages/Admin'));

const fallback = (
  <div className="mx-auto max-w-3xl px-4 py-16">
    <Skeleton lines={4} />
  </div>
);

/** Route guard: convenience only. Real authorization happens on the server. */
function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return fallback;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/dashboard" replace />;
  return <AppLayout>{children}</AppLayout>;
}

/** Applies the profile's preferred language once it loads. */
function LanguageFromProfile() {
  const { profile } = useAuth();
  const { setLang } = useI18n();
  useEffect(() => {
    if (profile?.preferredLanguage) setLang(profile.preferredLanguage);
  }, [profile?.preferredLanguage, setLang]);
  return null;
}

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <LanguageFromProfile />
        <BrowserRouter>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/new" element={<Protected><NewVerification /></Protected>} />
              <Route path="/investigations/:jobId" element={<Protected><Investigation /></Protected>} />
              <Route path="/results/:claimId" element={<Protected><Results /></Protected>} />
              <Route path="/history" element={<Protected><History /></Protected>} />
              <Route path="/settings" element={<Protected><Settings /></Protected>} />
              <Route path="/profile" element={<Protected><Profile /></Protected>} />
              <Route path="/learning" element={<Protected><LearningCenter /></Protected>} />
              <Route path="/progress" element={<Protected><StudentDashboard /></Protected>} />
              <Route path="/classrooms" element={<Protected><Classrooms /></Protected>} />
              <Route path="/classrooms/:classroomId" element={<Protected><ClassroomDetail /></Protected>} />
              <Route path="/teacher" element={<Protected roles={['teacher', 'admin']}><TeacherDashboard /></Protected>} />
              <Route path="/sources" element={<Protected><TrustedSources /></Protected>} />
              <Route path="/receipts" element={<Protected><Receipts /></Protected>} />
              <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
              <Route path="/admin" element={<Protected roles={['admin']}><Admin /></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
