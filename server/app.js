const express = require("express");
const helmet = require("helmet");
const path = require("node:path");
const { checkDatabase } = require("./database");

const publicDirectory = path.resolve(__dirname, "..", "public");

function createApp(options = {}) {
  const app = express();
  const databaseCheck = options.checkDatabase || checkDatabase;

  app.disable("x-powered-by");

  // The current login page contains inline JavaScript and the existing runtime
  // injects Hatchable auth behavior. Re-enable a restrictive CSP after auth is
  // migrated and the required script/style sources are known.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      // Avoid logging URLs, query strings, request bodies, or user identifiers.
      console.info(
        JSON.stringify({
          event: "http_request",
          method: req.method,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        }),
      );
    });
    next();
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));

  const readinessHandler = async (_req, res) => {
    try {
      await databaseCheck();
      return res.status(200).json({ status: "ready" });
    } catch {
      return res.status(503).json({ status: "not_ready" });
    }
  };

  app.get("/health", readinessHandler);
  app.get("/api/health", readinessHandler);

  app.get("/favicon.ico", (_req, res) => {
    res.sendStatus(204);
  });

  app.use(express.static(publicDirectory, { index: "index.html" }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error, _req, res, _next) => {
    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 500;

    console.error(
      JSON.stringify({
        event: "request_error",
        status,
        code: error.code || "internal_error",
      }),
    );

    res.status(status).json({
      error: status === 413 ? "Request too large" : "Request could not be processed",
    });
  });

  return app;
}

module.exports = { createApp };
