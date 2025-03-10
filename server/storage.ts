import { db } from "./db";
import { issues, fixes, metrics, settings, codeNodes, codeEdges, users } from "@shared/schema";
import { 
  Issue, InsertIssue, 
  Fix, InsertFix, 
  Metric, InsertMetric, 
  Settings, InsertSettings,
  CodeNode, InsertCodeNode,
  CodeEdge, InsertCodeEdge,
  User, InsertUser
} from "@shared/schema";
import { eq, asc, and } from "drizzle-orm";
import type { Issue as SharedIssue } from "@shared/schema";
import { pgTable, serial, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Define the database issue type to match the schema
interface DatabaseIssue {
  id: number;
  sentryId: string;
  title: string;
  stacktrace: string;
  status: string;
  context: {
    repository: string;
    issueUrl: string;
    labels: string[];
    codeSnippets: string[];
    githubMetadata: {
      owner: string;
      repo: string;
      issueNumber: number;
      created: string;
      updated: string;
    };
  };
  createdAt: Date | null;
}

export interface GitHubSettings {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
}

export interface IStorage {
  // Issues
  getIssue(id: number): Promise<Issue | undefined>;
  getIssues(): Promise<Issue[]>;
  createIssue(issue: InsertIssue): Promise<Issue>;
  updateIssueStatus(id: number, status: string): Promise<Issue>;

  // Fixes
  getFix(id: number): Promise<Fix | undefined>;
  getFixesByIssue(issueId: number): Promise<Fix[]>;
  createFix(fix: InsertFix): Promise<Fix>;
  updateFixStatus(id: number, status: string): Promise<Fix>;

  // Metrics
  getMetrics(): Promise<Metric[]>;
  createMetric(metric: InsertMetric): Promise<Metric>;

  // Settings
  getSettings(): Promise<GitHubSettings | null>;
  saveSettings(settings: InsertSettings): Promise<Settings>;

  // Knowledge Graph
  createCodeNode(node: InsertCodeNode): Promise<CodeNode>;
  getCodeNode(id: number): Promise<CodeNode | undefined>;
  getCodeNodes(): Promise<CodeNode[]>;
  createCodeEdge(edge: InsertCodeEdge): Promise<CodeEdge>;
  getCodeEdges(): Promise<CodeEdge[]>;

  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Chat
  getChatHistory(userId: number): Promise<ChatMessage[]>;
  saveChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatHistory(userId: number): Promise<void>;

  // New method
  clearGraph(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Issues
  async getIssue(id: number): Promise<Issue | undefined> {
    const [issue] = await db.select().from(issues).where(eq(issues.id, id));
    return issue ? this.mapDatabaseIssueToIssue(issue as DatabaseIssue) : undefined;
  }

  async getIssues(): Promise<Issue[]> {
    const dbIssues = await db.select().from(issues);
    return dbIssues.map(issue => this.mapDatabaseIssueToIssue(issue as DatabaseIssue));
  }

  async createIssue(insertIssue: InsertIssue): Promise<Issue> {
    const [issue] = await db.insert(issues).values(insertIssue).returning();
    return this.mapDatabaseIssueToIssue(issue as DatabaseIssue);
  }

  async updateIssueStatus(id: number, status: string): Promise<Issue> {
    const [issue] = await db
      .update(issues)
      .set({ status })
      .where(eq(issues.id, id))
      .returning();
    if (!issue) throw new Error("Issue not found");
    return this.mapDatabaseIssueToIssue(issue as DatabaseIssue);
  }

  // Helper method to map database issue to Issue type
  private mapDatabaseIssueToIssue(dbIssue: DatabaseIssue): Issue {
    return {
      id: dbIssue.id,
      title: dbIssue.title,
      status: dbIssue.status,
      stacktrace: dbIssue.stacktrace,
      context: dbIssue.context as Issue['context'] // Type assertion here is safe because we validate the structure in the database
    };
  }

  // Fixes
  async getFix(id: number): Promise<Fix | undefined> {
    const [fix] = await db.select().from(fixes).where(eq(fixes.id, id));
    return fix;
  }

  async getFixesByIssue(issueId: number): Promise<Fix[]> {
    return await db.select().from(fixes).where(eq(fixes.issueId, issueId));
  }

  async createFix(insertFix: InsertFix): Promise<Fix> {
    const [fix] = await db.insert(fixes).values(insertFix).returning();
    return fix;
  }

  async updateFixStatus(id: number, status: string): Promise<Fix> {
    const [fix] = await db
      .update(fixes)
      .set({ status })
      .where(eq(fixes.id, id))
      .returning();
    if (!fix) throw new Error("Fix not found");
    return fix;
  }

  // Metrics
  async getMetrics(): Promise<Metric[]> {
    return await db.select().from(metrics);
  }

  async createMetric(insertMetric: InsertMetric): Promise<Metric> {
    const [metric] = await db.insert(metrics).values(insertMetric).returning();
    return metric;
  }

  // Settings
  async getSettings(): Promise<GitHubSettings | null> {
    return {
      githubToken: process.env.GITHUB_TOKEN || '',
      githubOwner: process.env.GITHUB_OWNER || '',
      githubRepo: process.env.GITHUB_REPO || ''
    };
  }

  async saveSettings(insertSettings: InsertSettings): Promise<Settings> {
    await db.delete(settings);
    const [setting] = await db.insert(settings).values(insertSettings).returning();
    return setting;
  }

  // Knowledge Graph
  async createCodeNode(insertNode: InsertCodeNode): Promise<CodeNode> {
    try {
      console.log('\n=== Starting createCodeNode ===');
      console.log(`Creating code node for path: ${insertNode.path}`);
      console.log('Node data:', {
        path: insertNode.path,
        type: insertNode.type,
        name: insertNode.name,
        contentLength: insertNode.content?.length || 0
      });
      
      // Validate and prepare input data
      const nodeData = {
        path: insertNode.path,
        type: insertNode.type,
        name: insertNode.name,
        content: insertNode.content || '', // Ensure content is never null
        createdAt: new Date() // Add createdAt field
      };
      
      // Validate required fields
      if (!nodeData.path || !nodeData.type || !nodeData.name) {
        const error = new Error(`Invalid node data: missing required fields`);
        console.error('Validation error:', {
          hasPath: !!nodeData.path,
          hasType: !!nodeData.type,
          hasName: !!nodeData.name
        });
        throw error;
      }
      
      // Execute everything in a single transaction
      const [node] = await db.transaction(async (tx) => {
        try {
          console.log('Starting database transaction...');
          
          // Check if node already exists with exact match
          console.log('Checking for existing node...');
          const existingQuery = tx.select()
            .from(codeNodes)
            .where(sql`path = ${nodeData.path} AND type = ${nodeData.type} AND name = ${nodeData.name}`);
          
          console.log('Existing node query:', existingQuery.toSQL());
          const [existingNode] = await existingQuery;
            
          if (existingNode) {
            console.log(`Node already exists with ID: ${existingNode.id}`);
            return [existingNode];
          }
          
          // Create the insert query
          const insertQuery = tx.insert(codeNodes).values(nodeData).returning();
          const sqlString = insertQuery.toSQL();
          console.log('Insert query:', {
            sql: sqlString.sql,
            params: sqlString.params
          });
          
          // Execute the query
          const [createdNode] = await insertQuery;
          
          if (!createdNode) {
            console.error('No node was created - database returned empty result');
            throw new Error('Failed to create code node - no node returned');
          }
          
          console.log(`Successfully created code node with ID: ${createdNode.id}`);
          console.log('Created node data:', {
            id: createdNode.id,
            path: createdNode.path,
            type: createdNode.type,
            name: createdNode.name,
            contentLength: createdNode.content?.length || 0
          });
          
          // Verify the node was created by selecting it
          const verifyQuery = tx.select()
            .from(codeNodes)
            .where(sql`id = ${createdNode.id}`);
          const [verifiedNode] = await verifyQuery;
          
          if (!verifiedNode) {
            throw new Error(`Node verification failed - could not find node with ID ${createdNode.id}`);
          }
          
          return [createdNode];
        } catch (txError) {
          console.error('Transaction error creating code node:', txError);
          if (txError instanceof Error) {
            console.error('Error stack:', txError.stack);
            console.error('SQL Error:', txError.message);
          }
          throw txError;
        }
      });
      
      console.log('=== Finished createCodeNode successfully ===\n');
      return node;
    } catch (error) {
      console.error('=== Error in createCodeNode ===');
      console.error('Error creating code node:', error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      console.error('Node data:', {
        path: insertNode.path,
        type: insertNode.type,
        name: insertNode.name,
        contentLength: insertNode.content?.length || 0
      });
      throw error;
    }
  }

  async getCodeNode(id: number): Promise<CodeNode | undefined> {
    const [node] = await db.select().from(codeNodes).where(eq(codeNodes.id, id));
    return node;
  }

  async getCodeNodes(): Promise<CodeNode[]> {
    return await db.select().from(codeNodes);
  }

  async createCodeEdge(insertEdge: InsertCodeEdge): Promise<CodeEdge> {
    try {
      console.log(`Creating code edge: ${insertEdge.sourceId} -> ${insertEdge.targetId} (${insertEdge.type})`);
      console.log('Edge data:', JSON.stringify(insertEdge, null, 2));
      
      // Execute everything in a single transaction
      const [edge] = await db.transaction(async (tx) => {
        try {
          // Verify that both source and target nodes exist
          const [sourceNode] = await tx.select()
            .from(codeNodes)
            .where(eq(codeNodes.id, insertEdge.sourceId))
            .limit(1);
            
          const [targetNode] = await tx.select()
            .from(codeNodes)
            .where(eq(codeNodes.id, insertEdge.targetId))
            .limit(1);
            
          if (!sourceNode || !targetNode) {
            throw new Error(`Failed to create edge - ${!sourceNode ? 'source' : 'target'} node not found`);
          }
          
          const [createdEdge] = await tx.insert(codeEdges)
            .values(insertEdge)
            .returning();
            
          if (!createdEdge) {
            throw new Error('Failed to create code edge - no edge returned');
          }
          
          console.log(`Successfully created code edge with ID: ${createdEdge.id}`);
          return [createdEdge];
        } catch (txError) {
          console.error('Transaction error creating code edge:', txError);
          console.error('SQL Query:', tx.insert(codeEdges).values(insertEdge).toSQL());
          throw txError;
        }
      });
      
      return edge;
    } catch (error) {
      console.error('Error creating code edge:', error);
      console.error('Edge data:', insertEdge);
      throw error;
    }
  }

  async getCodeEdges(): Promise<CodeEdge[]> {
    return await db.select().from(codeEdges);
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Chat
  async getChatHistory(userId: number): Promise<ChatMessage[]> {
    try {
      return await db.select().from(chatMessages)
        .where(eq(chatMessages.userId, userId))
        .orderBy(asc(chatMessages.timestamp));
    } catch (error) {
      console.error('Error getting chat history:', error);
      return [];
    }
  }

  async saveChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    try {
      const [result] = await db.insert(chatMessages).values(message).returning();
      return result;
    } catch (error) {
      console.error('Error saving chat message:', error);
      throw error;
    }
  }

  async clearChatHistory(userId: number): Promise<void> {
    try {
      await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
    } catch (error) {
      console.error('Error clearing chat history:', error);
      throw error;
    }
  }

  async clearGraph(): Promise<void> {
    try {
      console.log('Clearing existing graph data...');
      
      await db.transaction(async (tx) => {
        // First disable triggers to avoid foreign key constraint issues
        await tx.execute(sql`SET session_replication_role = replica`);
        
        // Delete edges first
        await tx.delete(codeEdges);
        console.log('Deleted all code edges');
        
        // Then delete nodes
        await tx.delete(codeNodes);
        console.log('Deleted all code nodes');
        
        // Re-enable triggers
        await tx.execute(sql`SET session_replication_role = DEFAULT`);
        
        console.log('Successfully cleared graph data');
      });
    } catch (error) {
      console.error('Error clearing graph:', error);
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();

// Add this to the schema definitions
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  content: text('content').notNull(),
  isUser: boolean('is_user').notNull(),
  timestamp: timestamp('timestamp').notNull()
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;