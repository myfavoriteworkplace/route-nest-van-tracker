const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { csrfProtection, requireAuthentication } = require("./security");

const apiDirectory = path.resolve(__dirname, "..", "api");

function discoverRoutes(directory = apiDirectory, relativeDirectory = "") {
  const routes = [];
  for (const entry of fs.readdirSync(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      routes.push(...discoverRoutes(directory, relativePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

    const routeModule = require(path.join(directory, relativePath));
    if (
      typeof routeModule.handler !== "function" ||
      !Array.isArray(routeModule.methods) ||
      !routeModule.methods.length
    ) {
      throw new Error(`Invalid API route module: ${relativePath}`);
    }
    routes.push({
      access: routeModule.access || "user",
      handler: routeModule.handler,
      methods: routeModule.methods,
      path: `/${relativePath.replaceAll(path.sep, "/").replace(/\.js$/, "")}`,
    });
  }
  return routes;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApiRouter({ authService, routes = discoverRoutes() }) {
  const router = express.Router();
  const authenticate = requireAuthentication(authService);

  for (const route of routes) {
    if (!["user", "public"].includes(route.access)) {
      throw new Error(`Unsupported access mode for ${route.path}`);
    }
    for (const method of route.methods) {
      const register = router[String(method).toLowerCase()];
      if (typeof register !== "function") {
        throw new Error(`Unsupported method ${method} for ${route.path}`);
      }
      const middleware =
        route.access === "public"
          ? []
          : [authenticate, csrfProtection];
      register.call(router, route.path, ...middleware, asyncHandler(route.handler));
    }
  }

  return router;
}

module.exports = { createApiRouter, discoverRoutes };
