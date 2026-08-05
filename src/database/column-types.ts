/**
 * SQLite's 'datetime' column type is not valid on Postgres (needs 'timestamp').
 * Entities read this once at module load so the same decorator works on both engines.
 */
export const DATETIME_COLUMN_TYPE =
  (process.env.DB_ENGINE ?? 'sqlite').toLowerCase() === 'postgres'
    ? 'timestamp'
    : 'datetime';
