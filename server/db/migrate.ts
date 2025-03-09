import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const connectionString = process.env.DATABASE_URL || 
  `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`;

const pool = new Pool({ connectionString });
const db = drizzle(pool);

async function main() {
  console.log('Starting database migration...');
  console.log('Using connection:', connectionString.replace(/:[^:@]+@/, ':****@')); // Hide password in logs
  
  try {
    await migrate(db, {
      migrationsFolder: join(__dirname, '../../drizzle/migrations')
    });
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
}

main(); 