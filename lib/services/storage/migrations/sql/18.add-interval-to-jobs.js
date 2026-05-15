/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Migration 18: Add interval_minutes column to jobs table
 * Allows each job to define its own execution interval.
 * Default to NULL to use the global interval setting.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE jobs ADD COLUMN interval_minutes INTEGER DEFAULT NULL;
  `);
}
