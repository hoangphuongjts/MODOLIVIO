"use strict";

const { SqliteDatabase } = require("./sqlite.js");

/** Durable, strictly sequential queue. SQLite owns the idempotency boundary. */
class JobQueue {
  constructor(filename) {
    this.db = new SqliteDatabase(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK(state IN ('queued','running','done','failed')),
        payload TEXT NOT NULL, result TEXT, error TEXT,
        provider_task_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        scene_index INTEGER NOT NULL DEFAULT 0, scene_outputs TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state, created_at);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS product_snapshots (
        canonical_url TEXT PRIMARY KEY, platform TEXT NOT NULL, title TEXT,
        image_url TEXT, payload TEXT NOT NULL, saved_at INTEGER NOT NULL
      );
    `);
    const columns = new Set(/** @type {Array<{name: string}>} */ (this.db.pragma("table_info(jobs)")).map((column) => column.name));
    if (!columns.has("scene_index")) this.db.exec("ALTER TABLE jobs ADD COLUMN scene_index INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("scene_outputs")) this.db.exec("ALTER TABLE jobs ADD COLUMN scene_outputs TEXT NOT NULL DEFAULT '[]'");
    // Jobs that died before submitting to the provider are safe to retry. Jobs
    // with a provider task id are resumed by polling, never resubmitted.
    this.db.prepare("UPDATE jobs SET state='queued', updated_at=? WHERE state='running'")
      .run(Date.now());
  }

  enqueue({ id, idempotencyKey, payload }) {
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length > 200) {
      throw new Error("Thiếu Idempotency-Key hợp lệ");
    }
    const now = Date.now();
    this.db.prepare(`INSERT OR IGNORE INTO jobs(id,idempotency_key,state,payload,created_at,updated_at)
      VALUES(?,?, 'queued', ?, ?, ?)`)
      .run(id, idempotencyKey, JSON.stringify(payload), now, now);
    return /** @type {any} */ (this.db.prepare("SELECT * FROM jobs WHERE idempotency_key=?").get(idempotencyKey));
  }

  claimNext() {
    return this.db.transaction(() => {
      const active = this.db.prepare("SELECT id FROM jobs WHERE state='running' LIMIT 1").get();
      if (active) return null;
      const job = /** @type {any} */ (this.db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").get());
      if (!job) return null;
      this.db.prepare("UPDATE jobs SET state='running',updated_at=? WHERE id=? AND state='queued'").run(Date.now(), job.id);
      return this.get(job.id);
    })();
  }

  setProviderTask(id, taskId) {
    this.db.prepare("UPDATE jobs SET provider_task_id=?,updated_at=? WHERE id=? AND state='running'")
      .run(taskId, Date.now(), id);
  }
  saveSceneOutput(id, output) {
    this.db.transaction(() => {
      const job = /** @type {any} */ (this.db.prepare("SELECT scene_outputs,scene_index FROM jobs WHERE id=?").get(id));
      const outputs = JSON.parse(job.scene_outputs || "[]"); outputs[job.scene_index] = output;
      this.db.prepare("UPDATE jobs SET scene_outputs=?,scene_index=scene_index+1,provider_task_id=NULL,updated_at=? WHERE id=?")
        .run(JSON.stringify(outputs), Date.now(), id);
    })();
  }
  complete(id, result) {
    this.db.prepare("UPDATE jobs SET state='done',result=?,error=NULL,updated_at=? WHERE id=?")
      .run(JSON.stringify(result), Date.now(), id);
  }
  fail(id, error, result = null) {
    this.db.prepare("UPDATE jobs SET state='failed',error=?,result=?,updated_at=? WHERE id=?")
      .run(String(error).slice(0, 2000), result ? JSON.stringify(result) : null, Date.now(), id);
  }
  get(id) { return /** @type {any} */ (this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id)) || null; }
  getByIdempotencyKey(key) { return /** @type {any} */ (this.db.prepare("SELECT * FROM jobs WHERE idempotency_key=?").get(key)) || null; }
  list(limit = 100) { return this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(Math.min(500, limit)); }
  saveProduct({ canonicalUrl, platform, title, imageUrl, payload }) {
    this.db.prepare(`INSERT INTO product_snapshots(canonical_url,platform,title,image_url,payload,saved_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title,image_url=excluded.image_url,payload=excluded.payload,saved_at=excluded.saved_at`)
      .run(canonicalUrl, platform, title || null, imageUrl || null, JSON.stringify(payload), Date.now());
  }
  close() { this.db.close(); }
}

module.exports = { JobQueue };
