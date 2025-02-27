import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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

export const insertIssueSchema = createInsertSchema(issues).omit({ 
  id: true,
  createdAt: true 
});

export const insertFixSchema = createInsertSchema(fixes).omit({ 
  id: true,
  createdAt: true 
});

export const insertMetricSchema = createInsertSchema(metrics).omit({ 
  id: true,
  date: true 
});

export type Issue = typeof issues.$inferSelect;
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Fix = typeof fixes.$inferSelect;
export type InsertFix = z.infer<typeof insertFixSchema>;
export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
