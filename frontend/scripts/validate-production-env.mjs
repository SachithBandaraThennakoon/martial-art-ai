import { existsSync, readFileSync } from "node:fs";

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || !clean.includes("=")) return [];
    const index = clean.indexOf("=");
    return [[clean.slice(0, index).trim(), clean.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]];
  }));
}

const env = { ...readEnvFile(".env.production"), ...process.env };
const required = [
  "VITE_API_BASE_URL", "VITE_WS_BASE_URL", "VITE_COACH_API_BASE_URL",
  "VITE_PAYPAL_CLIENT_ID", "VITE_PAYPAL_STARTER_PLAN_ID",
  "VITE_PAYPAL_PRO_PLAN_ID", "VITE_PAYPAL_ELITE_PLAN_ID"
];
const placeholders = ["your_", "your-", "localhost", "example.com", "replace"];
const errors = [];

for (const name of required) {
  const value = String(env[name] || "").trim();
  if (!value || placeholders.some((marker) => value.toLowerCase().includes(marker))) {
    errors.push(`${name} is required and must not contain a placeholder`);
  }
}

function parsedUrl(name, scheme) {
  try {
    const url = new URL(env[name]);
    if (url.protocol !== `${scheme}:` || url.username || url.password) throw new Error();
    return url;
  } catch {
    errors.push(`${name} must be a valid ${scheme.toUpperCase()} URL without credentials`);
    return null;
  }
}

const api = parsedUrl("VITE_API_BASE_URL", "https");
const websocket = parsedUrl("VITE_WS_BASE_URL", "wss");
parsedUrl("VITE_COACH_API_BASE_URL", "https");
if (api && websocket && api.host !== websocket.host) {
  errors.push("VITE_API_BASE_URL and VITE_WS_BASE_URL must use the same host");
}
const planIds = ["VITE_PAYPAL_STARTER_PLAN_ID", "VITE_PAYPAL_PRO_PLAN_ID", "VITE_PAYPAL_ELITE_PLAN_ID"].map((name) => env[name]);
if (planIds.every(Boolean) && new Set(planIds).size !== planIds.length) {
  errors.push("PayPal plan IDs must be unique");
}

if (errors.length) {
  console.error(`Invalid frontend production environment:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("Frontend production environment is valid.");
