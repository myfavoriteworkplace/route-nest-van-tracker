const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createApiClient } = require("../public/api-client");

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("state-changing requests include cookies and the session CSRF token", async () => {
  const calls = [];
  const client = createApiClient({
    apiBaseUrl: "https://api.example.test/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/auth/csrf")) {
        return response(200, { csrfToken: "csrf-test-token" });
      }
      return response(201, { ok: true });
    },
  });

  const result = await client.request("/api/schools/create", "POST", {
    name: "Example School",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.example.test/api/auth/csrf");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[1].url, "https://api.example.test/api/schools/create");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.headers["X-CSRF-Token"], "csrf-test-token");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: "Example School",
  });
});

test("session reads use the configured API origin and do not fetch a CSRF token", async () => {
  const calls = [];
  const client = createApiClient({
    apiBaseUrl: "https://api.example.test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { user: { id: "user-1" } });
    },
  });

  const session = await client.getSession();

  assert.deepEqual(session, { user: { id: "user-1" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/api/auth/session");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.cache, "no-store");
});

test("the dashboard no longer depends on Hatchable authentication", () => {
  const dashboard = fs.readFileSync(
    path.resolve(__dirname, "../public/saas.js"),
    "utf8",
  );

  assert.doesNotMatch(dashboard, /window\.hatchable/);
  assert.match(dashboard, /RouteNestApi\.getSession/);
  assert.match(dashboard, /RouteNestApi\.logout/);
});

test("unauthorized API responses invoke the sign-in redirect callback", async () => {
  let redirected = false;
  const client = createApiClient({
    fetchImpl: async () => response(401, { error: "Authentication required." }),
    onUnauthorized: () => {
      redirected = true;
    },
  });

  await assert.rejects(client.getSession(), /Authentication required/);
  assert.equal(redirected, true);
});
