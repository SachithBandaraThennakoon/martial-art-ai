import { useState } from "react";
import { AuthContext } from "./auth";

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

  const login = (newToken, plan = "FREE_PLAN", profile = {}) => {
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
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userPlan");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    setToken(null);
    setUserPlan("FREE_PLAN");
    setUserRole("user");
    setUserName("");
  };

  return (
    <AuthContext.Provider
      value={{
        token,
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
