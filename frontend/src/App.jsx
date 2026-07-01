import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Training from "./pages/Training";
import CategoryPage from "./pages/CategoryPage";
import Pricing from "./pages/Pricing";

function AppRoutes() {
  const location = useLocation();
  const isStudio = location.pathname === "/training";

  return (
    <div className={`app-shell ${isStudio ? "app-shell--studio" : ""}`}>
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/categories/:categorySlug" element={<CategoryPage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/training"
          element={
            <ProtectedRoute>
              <Training />
            </ProtectedRoute>
          }
        />
      </Routes>
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
