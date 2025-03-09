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
import { eq } from "drizzle-orm";
import type { Issue as SharedIssue } from "@shared/schema";

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
    const [node] = await db.insert(codeNodes).values(insertNode).returning();
    return node;
  }

  async getCodeNode(id: number): Promise<CodeNode | undefined> {
    const [node] = await db.select().from(codeNodes).where(eq(codeNodes.id, id));
    return node;
  }

  async getCodeNodes(): Promise<CodeNode[]> {
    return await db.select().from(codeNodes);
  }

  async createCodeEdge(insertEdge: InsertCodeEdge): Promise<CodeEdge> {
    const [edge] = await db.insert(codeEdges).values(insertEdge).returning();
    return edge;
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
}

export const storage = new DatabaseStorage();