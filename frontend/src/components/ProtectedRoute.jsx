import { useContext } from "react";
import { AuthContext } from "../context/auth";
import { Navigate, useLocation } from "react-router-dom";

export default function ProtectedRoute({ children, requiredRole }) {
  const { token, userRole } = useContext(AuthContext);
  const location = useLocation();

  if (!token) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate replace to="/studio" />;
  }

  return children;
}
