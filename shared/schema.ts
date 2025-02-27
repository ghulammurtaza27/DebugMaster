import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Keep existing tables
export const issues = pgTable("issues", {
  id: serial("id").primaryKey(),
  sentryId: text("sentry_id").notNull(),
  title: text("title").notNull(),
  stacktrace: text("stacktrace").notNull(),
  status: text("status").notNull(), // new, analyzing, fixed, failed
  context: jsonb("context").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const fixes = pgTable("fixes", {
  id: serial("id").primaryKey(),
  issueId: integer("issue_id").notNull(),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  status: text("status").notNull(), // pending, created, merged, failed
  files: jsonb("files").notNull(),
  explanation: text("explanation").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  issuesProcessed: integer("issues_processed").notNull(),
  fixesAttempted: integer("fixes_attempted").notNull(),
  fixesSucceeded: integer("fixes_succeeded").notNull(),
  avgProcessingTime: integer("avg_processing_time").notNull(),
  date: timestamp("date").defaultNow(),
});

// Add settings table
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  sentryDsn: text("sentry_dsn").notNull(),
  sentryToken: text("sentry_token").notNull(),
  sentryOrg: text("sentry_org").notNull(),
  sentryProject: text("sentry_project").notNull(),
  githubToken: text("github_token").notNull(),
  githubOwner: text("github_owner").notNull(),
  githubRepo: text("github_repo").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Add after existing tables, before schemas
export const codeNodes = pgTable("code_nodes", {
  id: serial("id").primaryKey(),
  path: text("path").notNull(),
  type: text("type").notNull(), // file, function, class
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const codeEdges = pgTable("code_edges", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => codeNodes.id),
  targetId: integer("target_id").notNull().references(() => codeNodes.id),
  type: text("type").notNull(), // imports, calls, extends
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Keep existing schemas
export const insertIssueSchema = createInsertSchema(issues).omit({
  id: true,
  createdAt: true,
});

export const insertFixSchema = createInsertSchema(fixes).omit({
  id: true,
  createdAt: true,
});

export const insertMetricSchema = createInsertSchema(metrics).omit({
  id: true,
  date: true,
});

// Add settings schema
export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
  updatedAt: true,
});

// Add after existing schemas
export const insertNodeSchema = createInsertSchema(codeNodes).omit({
  id: true,
  createdAt: true,
});

export const insertEdgeSchema = createInsertSchema(codeEdges).omit({
  id: true,
  createdAt: true,
});

// Keep existing types
export type Issue = typeof issues.$inferSelect;
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Fix = typeof fixes.$inferSelect;
export type InsertFix = z.infer<typeof insertFixSchema>;
export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;

// Add settings types
export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;

// Add after existing types
export type CodeNode = typeof codeNodes.$inferSelect;
export type InsertCodeNode = z.infer<typeof insertNodeSchema>;
export type CodeEdge = typeof codeEdges.$inferSelect;
export type InsertCodeEdge = z.infer<typeof insertEdgeSchema>;