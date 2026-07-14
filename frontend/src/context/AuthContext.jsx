import { useCallback, useEffect, useState } from "react";
import { AuthContext } from "./auth";
import { API_BASE_URL } from "../services/api";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [userPlan, setUserPlan] = useState(
    localStorage.getItem("userPlan") || "FREE_PLAN"
  );
  const [userRole, setUserRole] = useState(
    localStorage.getItem("userRole") || "user"
  );
  const [userName, setUserName] = useState(
    localStorage.getItem("userName") || ""
  );
  const [authReady, setAuthReady] = useState(!localStorage.getItem("token"));

  const login = useCallback((newToken, plan = "FREE_PLAN", profile = {}) => {
    const role = profile.role || "user";
    const name = profile.name || "";
    localStorage.setItem("token", newToken);
    localStorage.setItem("userPlan", plan);
    localStorage.setItem("userRole", role);
    localStorage.setItem("userName", name);
    setToken(newToken);
    setUserPlan(plan);
    setUserRole(role);
    setUserName(name);
    setAuthReady(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("userPlan");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    setToken(null);
    setUserPlan("FREE_PLAN");
    setUserRole("user");
    setUserName("");
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!token) {
      setAuthReady(true);
      return undefined;
    }

    const controller = new AbortController();

    const validateSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/protected`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });

        if (response.status === 401) {
          logout();
          return;
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          // Keep the session during temporary network outages.
        }
      } finally {
        if (!controller.signal.aborted) {
          setAuthReady(true);
        }
      }
    };

    setAuthReady(false);
    validateSession();

    return () => controller.abort();
  }, [logout, token]);

  return (
    <AuthContext.Provider
      value={{
        token,
        authReady,
        login,
        logout,
        userPlan,
        setUserPlan,
        userRole,
        userName
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
