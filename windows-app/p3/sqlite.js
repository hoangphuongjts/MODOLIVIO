"use strict";

const { DatabaseSync } = require("node:sqlite");

/** Small compatibility surface over Node's built-in synchronous SQLite API. */
class SqliteDatabase {
  constructor(filename) { this.raw = new DatabaseSync(filename); }
  exec(sql) { return this.raw.exec(sql); }
  prepare(sql) { return this.raw.prepare(sql); }
  pragma(source, options = {}) {
    const sql = `PRAGMA ${source}`;
    if (/^\s*(journal_mode|synchronous|busy_timeout)\s*=/i.test(source)) {
      const result = this.raw.prepare(sql).get();
      const value = result ? Object.values(result)[0] : undefined;
      return options.simple ? value : result ? [result] : [];
    }
    const result = this.raw.prepare(sql).all();
    return options.simple ? result[0] && Object.values(result[0])[0] : result;
  }
  transaction(callback) {
    return (...args) => {
      this.raw.exec("BEGIN IMMEDIATE");
      try { const result = callback(...args); this.raw.exec("COMMIT"); return result; }
      catch (error) { this.raw.exec("ROLLBACK"); throw error; }
    };
  }
  close() { this.raw.close(); }
}

module.exports = { SqliteDatabase };
