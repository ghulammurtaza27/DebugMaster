import { db } from "./db";
import { issues, fixes, metrics, settings } from "@shared/schema";
import { Issue, InsertIssue, Fix, InsertFix, Metric, InsertMetric, Settings, InsertSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

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
  getSettings(): Promise<Settings | undefined>;
  saveSettings(settings: InsertSettings): Promise<Settings>;
}

export class DatabaseStorage implements IStorage {
  // Issues
  async getIssue(id: number): Promise<Issue | undefined> {
    const [issue] = await db.select().from(issues).where(eq(issues.id, id));
    return issue;
  }

  async getIssues(): Promise<Issue[]> {
    return await db.select().from(issues);
  }

  async createIssue(insertIssue: InsertIssue): Promise<Issue> {
    const [issue] = await db.insert(issues).values(insertIssue).returning();
    return issue;
  }

  async updateIssueStatus(id: number, status: string): Promise<Issue> {
    const [issue] = await db
      .update(issues)
      .set({ status })
      .where(eq(issues.id, id))
      .returning();
    if (!issue) throw new Error("Issue not found");
    return issue;
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

  // Add settings methods
  async getSettings(): Promise<Settings | undefined> {
    const [setting] = await db.select().from(settings);
    return setting;
  }

  async saveSettings(insertSettings: InsertSettings): Promise<Settings> {
    // Delete existing settings first since we only want one row
    await db.delete(settings);
    const [setting] = await db.insert(settings).values(insertSettings).returning();
    return setting;
  }
}

export const storage = new DatabaseStorage();