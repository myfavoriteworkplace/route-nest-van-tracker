const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const helmet = require("helmet");
const path = require("node:path");
const { checkDatabase, getPool } = require("./database");
const { loadConfig } = require("./config");
const { createAuthService } = require("./auth-service");
const { createAuthRouter } = require("./auth-routes");
const { createApiRouter } = require("./api-router");
const { createTenantService } = require("../lib/tenant");
const { csrfProtection } = require("./security");

const publicDirectory = path.resolve(__dirname, "..", "public");
const PostgresSessionStore = connectPgSimple(session);

function createOriginMiddleware(config) {
  return (req, res, next) => {
    const origin = req.get("Origin");
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    const allowedOrigins = new Set([requestOrigin, config.frontendUrl].filter(Boolean));

    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: "Origin not allowed." });
    }

    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.set("Access-Control-Max-Age", "600");
      return res.sendStatus(204);
    }
    return next();
  };
}

function createApp(options = {}) {
  const app = express();
  const config = options.config || loadConfig(options.env || process.env);
  const pool = options.pool || getPool();
  const databaseCheck =
    options.checkDatabase ||
    (options.pool ? () => pool.query("SELECT 1") : checkDatabase);
  const authService =
    options.authService || createAuthService({ pool, config, sendCode: options.sendCode });
  const sessionCookieName = "route_nest.sid";
  const sessionSameSite = config.frontendUrl ? "none" : "lax";
  const sessionCookieOptions = {
    httpOnly: true,
    path: "/",
    sameSite: sessionSameSite,
    secure: config.nodeEnv === "production",
  };
  const sessionStore =
    options.sessionStore ||
    new PostgresSessionStore({
      pool,
      tableName: "app_sessions",
      createTableIfMissing: false,
      pruneSessionInterval: 15 * 60,
    });

  app.disable("x-powered-by");
  if (config.trustProxyHops > 0) {
    app.set("trust proxy", config.trustProxyHops);
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", ...(config.frontendUrl ? [config.frontendUrl] : [])],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

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

  app.use(createOriginMiddleware(config));
  app.use(
    express.json({
      limit: "100kb",
      verify(req, _res, buffer) {
        if (req.path === "/api/webhooks/razorpay") {
          req.rawBody = Buffer.from(buffer);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  app.use(
    session({
      name: sessionCookieName,
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        ...sessionCookieOptions,
        maxAge: config.sessionMaxAgeSeconds * 1000,
      },
    }),
  );

  app.locals.pool = pool;
  app.locals.config = config;
  app.locals.authService = authService;
  app.locals.tenant = options.tenant || createTenantService(pool);

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

  app.get("/login", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "login.html"));
  });

  app.get("/favicon.ico", (_req, res) => {
    res.sendStatus(204);
  });

  app.use(
    "/api/auth",
    createAuthRouter({
      authService,
      cookieName: sessionCookieName,
      cookieOptions: sessionCookieOptions,
      csrfProtection,
    }),
  );
  app.use("/api", createApiRouter({ authService }));

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

    const body = {
      error:
        error.expose === true && typeof error.message === "string"
          ? error.message
          : status === 413
            ? "Request too large"
            : "Request could not be processed",
    };
    if (error.expose === true && error.code) body.code = error.code;
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
