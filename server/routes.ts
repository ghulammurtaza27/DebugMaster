import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import { sentryService } from "./services/sentry";
import { githubService } from "./services/github";
import { rateLimiter } from "./services/rate-limiter";
import { insertIssueSchema, insertFixSchema, insertMetricSchema } from "@shared/schema";

export async function registerRoutes(app: Express) {
  // Issues
  app.get("/api/issues", async (req, res) => {
    const issues = await storage.getIssues();
    res.json(issues);
  });

  app.get("/api/issues/:id", async (req, res) => {
    const issue = await storage.getIssue(parseInt(req.params.id));
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    res.json(issue);
  });

  app.post("/api/issues", async (req, res) => {
    const parsed = insertIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.errors });
    }
    const issue = await storage.createIssue(parsed.data);
    res.json(issue);
  });

  // Fixes
  app.get("/api/fixes/:issueId", async (req, res) => {
    const fixes = await storage.getFixesByIssue(parseInt(req.params.issueId));
    res.json(fixes);
  });

  app.post("/api/fixes", async (req, res) => {
    const parsed = insertFixSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.errors });
    }
    const fix = await storage.createFix(parsed.data);
    res.json(fix);
  });

  // Metrics
  app.get("/api/metrics", async (req, res) => {
    const metrics = await storage.getMetrics();
    res.json(metrics);
  });

  // Webhook handler for new Sentry issues
  app.post("/api/webhook/sentry", async (req, res) => {
    if (rateLimiter.isRateLimited("sentry")) {
      return res.status(429).json({ message: "Too many requests" });
    }

    try {
      const issueData = req.body;
      const details = await sentryService.getIssueDetails(issueData.id);
      
      const issue = await storage.createIssue({
        sentryId: details.id,
        title: details.title,
        stacktrace: details.stacktrace,
        status: "new",
        context: details.context
      });

      res.json(issue);
    } catch (error) {
      console.error("Error processing Sentry webhook:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
