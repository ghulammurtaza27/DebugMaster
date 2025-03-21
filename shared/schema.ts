import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Add users table with subscription fields
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").default("inactive"),
  subscriptionTier: text("subscription_tier").default("free"),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Add subscriptions table
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  status: text("status").notNull(),
  tier: text("tier").notNull(),
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  validationData: jsonb("validation_data"),
});

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

export const insertIssueSchema = createInsertSchema(issues).omit({
  id: true,
  createdAt: true,
});

export const insertFixSchema = createInsertSchema(fixes).omit({
  id: true,
  createdAt: true,
});

export const insertMetricSchema = createInsertSchema(metrics).omit({
  id: true
}).extend({
  validationData: z.object({
    issueId: z.union([z.string(), z.number()]),
    file: z.string(),
    validationIssues: z.array(z.string()),
    timestamp: z.string()
  }).optional()
});

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  role: true,
  createdAt: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  subscriptionTier: true,
  trialEndsAt: true
}).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
});

export const insertNodeSchema = createInsertSchema(codeNodes).omit({
  id: true,
  createdAt: true,
});

export const insertEdgeSchema = createInsertSchema(codeEdges).omit({
  id: true,
  createdAt: true,
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
});

export interface Issue {
  id: number | string;
  title: string;
  status: string;
  stacktrace: string;
  context: {
    repository: string;
    issueUrl: string;
    labels: string[];
    codeSnippets: string[];
    files?: Array<{
      path: string;
      content: string;
      relevance?: number;
    }>;
    projectContext?: {
      projectStructure: {
        hierarchy: Record<string, string[]>;
        dependencies: Record<string, string[]>;
        dependents: Record<string, string[]>;
        testCoverage: Record<string, any>;
      };
      dependencies: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        peerDependencies: Record<string, string>;
      };
    };
    githubMetadata: {
      owner: string;
      repo: string;
      issueNumber: number;
      created: string;
      updated: string;
    };
  };
}

export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Fix = typeof fixes.$inferSelect;
export type InsertFix = z.infer<typeof insertFixSchema>;
export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type CodeNode = typeof codeNodes.$inferSelect;
export type InsertCodeNode = z.infer<typeof insertNodeSchema>;
export type CodeEdge = typeof codeEdges.$inferSelect;
export type InsertCodeEdge = z.infer<typeof insertEdgeSchema>;

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;