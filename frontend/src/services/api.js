const runtimeEnv = import.meta.env || {};

export const API_BASE_URL =
  runtimeEnv.VITE_API_BASE_URL || "/api";

export const COACH_API_BASE_URL =
  runtimeEnv.VITE_COACH_API_BASE_URL || "http://localhost:3001";

export const WS_BASE_URL =
  runtimeEnv.VITE_WS_BASE_URL || "ws://localhost:8000";
