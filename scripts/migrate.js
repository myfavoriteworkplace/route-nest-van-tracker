require("dotenv").config();

const { closePool, getPool } = require("../server/database");
const { runMigrations } = require("../server/migrations");

async function main() {
  try {
    const result = await runMigrations(getPool());
    console.info(
      `Migration run complete: ${result.appliedCount} applied, ${result.totalCount} total.`,
    );
  } catch (error) {
    console.error(`[db:migrate] ${error.message}`);
    if (error.code) {
      console.error(`[db:migrate] error code: ${error.code}`);
    }
    process.exitCode = 1;
  } finally {
    try {
      await closePool();
    } catch {
      console.error("[db:migrate] Failed to close PostgreSQL connections.");
      process.exitCode = 1;
    }
  }
}

main();
