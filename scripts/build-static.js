const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.resolve(__dirname, "..", "public");
const outputDirectory = path.resolve(__dirname, "..", "dist");
const configuredApiBase = String(process.env.API_BASE_URL || "").trim();

let apiBaseUrl = "";
if (configuredApiBase) {
  let parsed;
  try {
    parsed = new URL(
      configuredApiBase.includes("://")
        ? configuredApiBase
        : `https://${configuredApiBase}`,
    );
  } catch {
    throw new Error("API_BASE_URL must be a valid HTTPS origin or hostname.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("API_BASE_URL must be a valid HTTPS origin or hostname.");
  }
  apiBaseUrl = parsed.origin;
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(publicDirectory, outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, "runtime-config.js"),
  `window.RouteNestConfig = ${JSON.stringify({ apiBaseUrl })};\n`,
  "utf8",
);
console.info("Static frontend built.");
