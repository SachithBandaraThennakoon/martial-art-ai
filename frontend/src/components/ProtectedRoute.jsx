import { useContext } from "react";
import { AuthContext } from "../context/auth";
import { Navigate, useLocation } from "react-router";

export default function ProtectedRoute({ children, requiredRole }) {
  const { token, authReady, userRole } = useContext(AuthContext);
  const location = useLocation();

  if (!authReady) {
    return (
      <main className="route-loader" role="status">
        <span className="studio-live-dot" aria-hidden="true" />
        Checking your session…
      </main>
    );
  }

  if (!token) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate replace to="/studio" />;
  }

  return children;
}
