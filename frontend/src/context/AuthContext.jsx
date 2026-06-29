import { useState } from "react";
import { AuthContext } from "./auth";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [userPlan, setUserPlan] = useState(
    localStorage.getItem("userPlan") || "FREE_PLAN"
  );

  const login = (newToken, plan = "FREE_PLAN") => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("userPlan", plan);
    setToken(newToken);
    setUserPlan(plan);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userPlan");
    setToken(null);
    setUserPlan("FREE_PLAN");
  };

  return (
    <AuthContext.Provider value={{ token, login, logout, userPlan, setUserPlan }}>
      {children}
    </AuthContext.Provider>
  );
}
