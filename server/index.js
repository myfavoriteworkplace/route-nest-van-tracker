require("dotenv").config();

const { createApp } = require("./app");
const { closePool } = require("./database");

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port number.");
}

const server = createApp().listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      event: "server_listening",
      host: "0.0.0.0",
      port,
    }),
  );
});

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.info(JSON.stringify({ event: "server_shutdown", signal }));
  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (error) => {
    try {
      await closePool();
      if (error) {
        console.error("HTTP server shutdown failed.");
        process.exitCode = 1;
      }
    } catch {
      console.error("PostgreSQL pool shutdown failed.");
      process.exitCode = 1;
    } finally {
      clearTimeout(forceExit);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
