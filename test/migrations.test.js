const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadMigrations } = require("../server/migrations");

test("loads the existing migrations in version order with checksums", () => {
  const migrations = loadMigrations();

  assert.deepEqual(
    migrations.map((migration) => migration.version),
    ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"],
  );
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
    assert.ok(migration.sql.trim().length > 0);
  }
});

test("rejects migration SQL files that do not have a versioned filename", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "svt-migrations-"));
  try {
    fs.writeFileSync(path.join(directory, "notes.sql"), "SELECT 1;");
    assert.throws(() => loadMigrations(directory), /Invalid migration filename/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate migration versions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "svt-migrations-"));
  try {
    fs.writeFileSync(path.join(directory, "0001_first.sql"), "SELECT 1;");
    fs.writeFileSync(path.join(directory, "0001_second.sql"), "SELECT 2;");
    assert.throws(() => loadMigrations(directory), /Duplicate migration version/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
