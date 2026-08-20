import { API_BASE_URL } from "./api.js";

const ACCESS_TOKEN_STORAGE_KEY = "xma-tab-access-token-v1";

function readTabAccessToken() {
  try {
    return window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveTabAccessToken(token) {
  try {
    if (token) window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // In-memory authentication remains available when storage is blocked.
  }
}

let accessToken = typeof window === "undefined" ? null : readTabAccessToken();
let refreshPromise = null;
const tokenListeners = new Set();
const REFRESH_TIMEOUT_MS = 10_000;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  saveTabAccessToken(accessToken);
  tokenListeners.forEach((listener) => listener(accessToken));
}

export function subscribeAccessToken(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    const requestRefresh = () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      return fetch(`${API_BASE_URL}/refresh`, {
        method: "POST",
        credentials: "include",
        signal: controller.signal
      })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          setAccessToken(null);
          return null;
        }
        if (!response.ok) throw new Error(`Session refresh failed (${response.status})`);
        const session = await response.json();
        setAccessToken(session.access_token);
        return session;
      })
      .finally(() => window.clearTimeout(timeout));
    };

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
  if (token && accessTokenExpiresAt(token) <= Date.now()) {
    setAccessToken(null);
    token = null;
  }
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
