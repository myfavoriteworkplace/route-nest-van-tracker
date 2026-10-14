const { Pool } = require("pg");

let pool;

function getPoolOptions(env = process.env) {
  if (!env.DATABASE_URL || !env.DATABASE_URL.trim()) {
    throw new Error("DATABASE_URL is required for PostgreSQL access.");
  }

  const max = Number(env.DB_POOL_MAX || 8);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new Error("DB_POOL_MAX must be an integer between 1 and 50.");
  }

  return {
    connectionString: env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPoolOptions());
    pool.on("error", (error) => {
      // Do not log connection strings, SQL, or provider error messages.
      console.error(
        JSON.stringify({
          event: "postgres_pool_error",
          code: error.code || "unknown",
        }),
      );
    });
  }

  return pool;
}

async function checkDatabase() {
  await getPool().query("SELECT 1");
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await callback(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    const currentPool = pool;
    pool = undefined;
    await currentPool.end();
  }
}

module.exports = {
  checkDatabase,
  closePool,
  getPool,
  getPoolOptions,
  withTransaction,
};
