import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import 'dotenv/config';

// Add debugging
console.log('Current environment:', process.env.NODE_ENV);
console.log('Env file loaded:', process.env.DATABASE_URL ? 'Yes' : 'No');
console.log('DATABASE_URL:', process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Check your .env file");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// Add connection testing
pool.connect()
  .then(() => {
    console.log('Successfully connected to PostgreSQL');
  })
  .catch((err) => {
    console.error('Database connection error:', err);
  });
