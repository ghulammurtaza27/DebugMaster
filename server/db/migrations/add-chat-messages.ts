import { sql } from 'drizzle-orm';
import { db } from '../index';

export async function addChatMessagesTable() {
  console.log('Running migration: Add chat_messages table');
  
  try {
    // Check if the table already exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chat_messages'
      );
    `);
    
    if (tableExists.rows[0].exists) {
      console.log('chat_messages table already exists, skipping migration');
      return;
    }
    
    // Create the chat_messages table
    await db.execute(sql`
      CREATE TABLE chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_user BOOLEAN NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    
    console.log('Successfully created chat_messages table');
  } catch (error) {
    console.error('Error creating chat_messages table:', error);
    throw error;
  }
} 