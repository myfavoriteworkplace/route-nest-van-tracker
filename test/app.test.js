const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../server/app");

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("readiness reports ready only when the database check succeeds", async () => {
  await withServer(
    createApp({ checkDatabase: async () => {} }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ready" });
    },
  );
});

test("readiness hides database failure details and returns 503", async () => {
  await withServer(
    createApp({
      checkDatabase: async () => {
        throw new Error("private database host or credentials");
      },
    }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "not_ready" });
    },
  );
});

test("the existing dashboard is served as the root page", async () => {
  await withServer(
    createApp({ checkDatabase: async () => {} }),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(await response.text(), /RouteNest — School Van Tracker/);
    },
  );
});
