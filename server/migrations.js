const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(__dirname, "..", "migrations");
const MIGRATION_LOCK_ID = 704_202_610;
const MIGRATION_FILENAME_PATTERN = /^(\d{4})_[a-z0-9_-]+\.sql$/i;

function loadMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const sqlFiles = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name);

  const migrations = sqlFiles.map((filename) => {
    const match = filename.match(MIGRATION_FILENAME_PATTERN);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const sql = fs.readFileSync(path.join(directory, filename), "utf8");
    return {
      version: match[1],
      filename,
      sql,
      checksum: crypto.createHash("sha256").update(sql).digest("hex"),
    };
  });

  migrations.sort((left, right) => left.version.localeCompare(right.version));

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(
        `Duplicate migration version: ${migrations[index].version}`,
      );
    }
  }

  return migrations;
}

async function runMigrations(pool, directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const migrations = loadMigrations(directory);
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const result = await client.query(
      "SELECT version, filename, checksum FROM app_schema_migrations ORDER BY version",
    );
    const applied = new Map(result.rows.map((row) => [row.version, row]));
    const migrationsByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    );

    for (const row of result.rows) {
      if (!migrationsByVersion.has(row.version)) {
        throw new Error(
          `Applied migration ${row.version} is missing from the migrations directory.`,
        );
      }
    }

    let foundUnapplied = false;
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (!existing) {
        foundUnapplied = true;
        continue;
      }

      if (foundUnapplied) {
        throw new Error(
          `Migration history has a gap before already-applied version ${migration.version}.`,
        );
      }
      if (
        existing.filename !== migration.filename ||
        existing.checksum !== migration.checksum
      ) {
        throw new Error(
          `Applied migration ${migration.version} differs from the source file; add a new forward migration instead.`,
        );
      }
    }

    let appliedCount = 0;
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO app_schema_migrations (version, filename, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
        appliedCount += 1;
        console.info(
          JSON.stringify({
            event: "migration_applied",
            version: migration.version,
            filename: migration.filename,
          }),
        );
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        const migrationError = new Error(
          `Migration ${migration.filename} failed.`,
        );
        migrationError.code = error.code || "migration_failed";
        throw migrationError;
      }
    }

    return { appliedCount, totalCount: migrations.length };
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
        .catch(() => {});
    }
    client.release();
  }
}

module.exports = { loadMigrations, runMigrations };
