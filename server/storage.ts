import { Issue, InsertIssue, Fix, InsertFix, Metric, InsertMetric } from "@shared/schema";

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
}

export class MemStorage implements IStorage {
  private issues: Map<number, Issue>;
  private fixes: Map<number, Fix>;
  private metrics: Map<number, Metric>;
  private currentIds: { [key: string]: number };

  constructor() {
    this.issues = new Map();
    this.fixes = new Map();
    this.metrics = new Map();
    this.currentIds = { issues: 1, fixes: 1, metrics: 1 };
  }

  // Issues
  async getIssue(id: number): Promise<Issue | undefined> {
    return this.issues.get(id);
  }

  async getIssues(): Promise<Issue[]> {
    return Array.from(this.issues.values());
  }

  async createIssue(insertIssue: InsertIssue): Promise<Issue> {
    const id = this.currentIds.issues++;
    const issue: Issue = { 
      ...insertIssue, 
      id,
      createdAt: new Date()
    };
    this.issues.set(id, issue);
    return issue;
  }

  async updateIssueStatus(id: number, status: string): Promise<Issue> {
    const issue = await this.getIssue(id);
    if (!issue) throw new Error("Issue not found");
    
    const updated = { ...issue, status };
    this.issues.set(id, updated);
    return updated;
  }

  // Fixes
  async getFix(id: number): Promise<Fix | undefined> {
    return this.fixes.get(id);
  }

  async getFixesByIssue(issueId: number): Promise<Fix[]> {
    return Array.from(this.fixes.values())
      .filter(fix => fix.issueId === issueId);
  }

  async createFix(insertFix: InsertFix): Promise<Fix> {
    const id = this.currentIds.fixes++;
    const fix: Fix = {
      ...insertFix,
      id,
      createdAt: new Date()
    };
    this.fixes.set(id, fix);
    return fix;
  }

  async updateFixStatus(id: number, status: string): Promise<Fix> {
    const fix = await this.getFix(id);
    if (!fix) throw new Error("Fix not found");
    
    const updated = { ...fix, status };
    this.fixes.set(id, updated);
    return updated;
  }

  // Metrics
  async getMetrics(): Promise<Metric[]> {
    return Array.from(this.metrics.values());
  }

  async createMetric(insertMetric: InsertMetric): Promise<Metric> {
    const id = this.currentIds.metrics++;
    const metric: Metric = {
      ...insertMetric,
      id,
      date: new Date()
    };
    this.metrics.set(id, metric);
    return metric;
  }
}

export const storage = new MemStorage();
