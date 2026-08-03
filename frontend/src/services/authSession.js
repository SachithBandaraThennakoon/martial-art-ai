import { API_BASE_URL } from "./api.js";

let accessToken = null;
let refreshPromise = null;
const tokenListeners = new Set();

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  tokenListeners.forEach((listener) => listener(accessToken));
}

export function subscribeAccessToken(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    const requestRefresh = () => fetch(`${API_BASE_URL}/refresh`, {
      method: "POST",
      credentials: "include"
    })
      .then(async (response) => {
        if (!response.ok) {
          setAccessToken(null);
          return null;
        }
        const session = await response.json();
        setAccessToken(session.access_token);
        return session;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      });

    const coordinatedRefresh =
      typeof navigator !== "undefined" && navigator.locks?.request
        ? navigator.locks.request("martial-art-ai-refresh", requestRefresh)
        : requestRefresh();

    refreshPromise = coordinatedRefresh
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function authFetch(input, options = {}) {
  let token = getAccessToken();
  if (!token) {
    const session = await refreshAccessToken();
    token = session?.access_token || null;
  }

  const request = (activeToken) => {
    const headers = new Headers(options.headers || {});
    if (activeToken) headers.set("Authorization", `Bearer ${activeToken}`);
    return fetch(input, {
      ...options,
      credentials: "include",
      headers
    });
  };

  let response = await request(token);
  if (response.status !== 401) return response;

  const session = await refreshAccessToken();
  if (!session?.access_token) return response;
  response = await request(session.access_token);
  return response;
}

export async function endSession() {
  setAccessToken(null);
  try {
    await fetch(`${API_BASE_URL}/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // Local sign-out still succeeds if the service is temporarily unavailable.
  }
}

export function accessTokenExpiresAt(token = accessToken) {
  if (!token) return 0;
  try {
    const segment = token.split(".")[1];
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized));
    return Number(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}
