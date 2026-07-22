import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import FloatingParticles from "./components/MeditationHero/components/FloatingParticles";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Studio from "./pages/Studio";
import CategoryPage from "./pages/CategoryPage";
import Pricing from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import Contact from "./pages/Contact";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

const Training = lazy(() => import("./pages/Training"));
const ModelTestPage = lazy(() => import("./pages/ModelTestPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));

function AppRoutes() {
  const location = useLocation();
  const isStudio =
    location.pathname === "/training" || location.pathname === "/admin-training";
  const isLiveStudioRoute = [
    "/admin-studio",
    "/training",
    "/admin-training",
  ].includes(location.pathname);
  const showSharedParticles = location.pathname !== "/" && !isLiveStudioRoute;
  const isDashboard = location.pathname.startsWith("/dashboard");

  return (
    <div className={`app-shell ${isStudio ? "app-shell--studio" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navbar />

      <div id="main-content" tabIndex="-1">
        {showSharedParticles ? (
          <FloatingParticles
            className="meditation-particles--app"
            count={140}
            seed={97}
            area="app-page"
          />
        ) : null}
        <Suspense
          fallback={
            <main className="route-loader" role="status">
              <span className="studio-live-dot" aria-hidden="true" />
              Preparing movement engine…
            </main>
          }
        >
          <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/categories/:categorySlug" element={<CategoryPage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/contact" element={<Contact />} />
        <Route
          path="/model-test"
          element={
            <ProtectedRoute requiredRole="admin">
              <ModelTestPage />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route
          path="/studio"
          element={
            <ProtectedRoute>
              <Studio />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard/:page?"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin-studio"
          element={
            <ProtectedRoute requiredRole="admin">
              <Studio isAdminStudio />
            </ProtectedRoute>
          }
        />

        <Route
          path="/training"
          element={
            <ProtectedRoute>
              <Training />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin-training"
          element={
            <ProtectedRoute requiredRole="admin">
              <Training studioMode="admin" />
            </ProtectedRoute>
          }
        />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
      {!isStudio && !isDashboard ? <Footer /> : null}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
