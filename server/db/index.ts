import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Create PostgreSQL connection pool with explicit parameters
const pool = new pg.Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'cricket',
  database: process.env.DATABASE_NAME || 'debug-master'
});

// Add error handler for unexpected pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
  process.exit(-1);
});

// Test the connection
pool.connect()
  .then(client => {
    console.log('Successfully connected to PostgreSQL');
    client.release();
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL:', err);
    process.exit(-1);
  });

// Create drizzle database instance
const db = drizzle(pool);

// Export both pool and drizzle instance
export { pool, db }; 