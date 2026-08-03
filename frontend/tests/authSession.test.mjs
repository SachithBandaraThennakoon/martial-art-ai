import assert from "node:assert/strict";
import test from "node:test";

import {
  accessTokenExpiresAt,
  authFetch,
  endSession,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  subscribeAccessToken
} from "../src/services/authSession.js";


const jsonResponse = (body, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json" } }
);


test.afterEach(() => {
  setAccessToken(null);
  delete globalThis.fetch;
});


test("access tokens stay in memory and notify subscribers", () => {
  const observed = [];
  const unsubscribe = subscribeAccessToken((token) => observed.push(token));

  setAccessToken("access-one");
  setAccessToken(null);
  unsubscribe();

  assert.equal(getAccessToken(), null);
  assert.deepEqual(observed, ["access-one", null]);
});


test("authenticated requests rotate and retry once after a 401", async () => {
  const calls = [];
  setAccessToken("expired-access");
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("Authorization") });
    if (String(url).endsWith("/refresh")) {
      return jsonResponse({ access_token: "fresh-access", plan: "FREE_PLAN" });
    }
    if (calls.filter((call) => call.url.endsWith("/protected-resource")).length === 1) {
      return jsonResponse({ detail: "expired" }, 401);
    }
    return jsonResponse({ ok: true });
  };

  const response = await authFetch("http://service.test/protected-resource");

  assert.equal(response.status, 200);
  assert.equal(getAccessToken(), "fresh-access");
  assert.deepEqual(calls.map((call) => call.authorization), [
    "Bearer expired-access",
    null,
    "Bearer fresh-access"
  ]);
});


test("concurrent refresh requests share one in-flight rotation", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse({ access_token: "shared-access" });
  };

  const [first, second] = await Promise.all([
    refreshAccessToken(),
    refreshAccessToken()
  ]);

  assert.equal(calls, 1);
  assert.equal(first.access_token, "shared-access");
  assert.equal(second.access_token, "shared-access");
});


test("access token expiry is read without persisting the token", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 }))
    .toString("base64url");
  const token = `header.${payload}.signature`;

  assert.equal(accessTokenExpiresAt(token), 2_000_000_000_000);
});


test("logout clears memory even when the network is unavailable", async () => {
  setAccessToken("active-access");
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  await endSession();

  assert.equal(getAccessToken(), null);
});

