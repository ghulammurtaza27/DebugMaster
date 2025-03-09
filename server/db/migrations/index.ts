import { addChatMessagesTable } from './add-chat-messages';
import { db } from '../index';
import { sql } from 'drizzle-orm';

export async function runMigrations() {
  console.log('Running all migrations...');
  
  try {
    // Check database connection
    console.log('Testing database connection...');
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log('Database connection successful:', result.rows[0]);
    
    // Run migrations in order
    console.log('Running chat messages table migration...');
    await addChatMessagesTable();
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
} 