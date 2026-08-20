import { useCallback, useEffect, useState } from "react";
import { AuthContext } from "./auth";
import { API_BASE_URL } from "../services/api";
import {
  accessTokenExpiresAt,
  authFetch,
  endSession,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  subscribeAccessToken
} from "../services/authSession";

const PROFILE_CACHE_KEY = "xma-session-profile-v1";

function readProfileCache() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function saveProfileCache(profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      plan: profile.plan || "FREE_PLAN",
      role: profile.role || "user",
      name: profile.name || "",
      subscription_status: profile.subscription_status || "inactive"
    }));
  } catch {
    // The cache only prevents navigation flicker; authentication uses the cookie.
  }
}

export function AuthProvider({ children }) {
  const [cachedProfile] = useState(readProfileCache);
  const [token, setTokenState] = useState(() => {
    const legacyToken = localStorage.getItem("token");
    localStorage.removeItem("token");
    const restoredToken = legacyToken || getAccessToken();
    setAccessToken(restoredToken);
    return restoredToken;
  });
  const [userPlan, setUserPlan] = useState(cachedProfile.plan || "FREE_PLAN");
  const [userRole, setUserRole] = useState(cachedProfile.role || "user");
  const [userName, setUserName] = useState(cachedProfile.name || "");
  const [subscriptionStatus, setSubscriptionStatus] = useState(cachedProfile.subscription_status || "inactive");
  const [authReady, setAuthReady] = useState(false);

  const applyProfile = useCallback((profile = {}) => {
    setUserPlan(profile.plan || "FREE_PLAN");
    setUserRole(profile.role || "user");
    setUserName(profile.name || "");
    setSubscriptionStatus(profile.subscription_status || "inactive");
    if (profile.name) saveProfileCache(profile);
  }, []);

  const login = useCallback((newToken, plan = "FREE_PLAN", profile = {}) => {
    localStorage.removeItem("token");
    localStorage.removeItem("userPlan");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    setAccessToken(newToken);
    applyProfile({ ...profile, plan });
    setAuthReady(true);
  }, [applyProfile]);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("userPlan");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    localStorage.removeItem(PROFILE_CACHE_KEY);
    endSession();
    applyProfile();
    setAuthReady(true);
  }, [applyProfile]);

  const refreshProfile = useCallback(async (activeToken = token) => {
    if (!activeToken) return null;
    if (activeToken && activeToken !== getAccessToken()) setAccessToken(activeToken);
    const response = await authFetch(`${API_BASE_URL}/me`);
    if (response.status === 401) {
      logout();
      return null;
    }
    if (!response.ok) {
      throw new Error("Account status is temporarily unavailable");
    }
    const profile = await response.json();
    applyProfile(profile);
    return profile;
  }, [applyProfile, logout, token]);

  useEffect(() => subscribeAccessToken(setTokenState), []);

  useEffect(() => {

    const controller = new AbortController();

    const validateSession = async () => {
      try {
        let session = null;
        if (!getAccessToken()) session = await refreshAccessToken();
        if (session) applyProfile(session);
        if (!getAccessToken()) {
          applyProfile();
          return;
        }
        const response = await authFetch(`${API_BASE_URL}/me`, {
          signal: controller.signal
        });
        if (response.status === 401) {
          applyProfile();
          setAccessToken(null);
          return;
        }
        if (!response.ok) throw new Error("Account status is temporarily unavailable");
        applyProfile(await response.json());
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
  }, [applyProfile]);

  useEffect(() => {
    if (!token) return undefined;
    const expiresAt = accessTokenExpiresAt(token);
    const delay = Math.max(1000, expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(async () => {
      try {
        const session = await refreshAccessToken();
        if (session) applyProfile(session);
      } catch {
        // Keep the current session during a temporary API or network outage.
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [applyProfile, token]);

  return (
    <AuthContext.Provider
      value={{
        token,
        authReady,
        login,
        logout,
        refreshProfile,
        userPlan,
        userRole,
        userName,
        subscriptionStatus
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
