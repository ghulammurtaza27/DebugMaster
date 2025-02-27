import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import { sentryService } from "./services/sentry";
import { githubService } from "./services/github";
import { rateLimiter } from "./services/rate-limiter";
import { insertIssueSchema, insertFixSchema, insertMetricSchema, insertSettingsSchema } from "@shared/schema";
import { issueAnalyzer } from "./services/issue-analyzer";

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

  // Add settings routes
  app.get("/api/settings", async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings || {});
  });

  app.post("/api/settings", async (req, res) => {
    const parsed = insertSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.errors });
    }

    try {
      // Test Sentry connection
      const sentry = new sentryService(parsed.data.sentryDsn, parsed.data.sentryToken);
      await sentry.testConnection();

      // Test GitHub connection
      const github = new githubService(parsed.data.githubToken);
      await github.testConnection(parsed.data.githubOwner, parsed.data.githubRepo);

      const settings = await storage.saveSettings(parsed.data);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
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

      // Process the issue asynchronously
      issueAnalyzer.analyzeIssue(issue).catch(error => {
        console.error("Error processing issue:", error);
      });

      // Update metrics
      const metrics = await storage.getMetrics();
      const latestMetric = metrics[metrics.length - 1];

      await storage.createMetric({
        issuesProcessed: (latestMetric?.issuesProcessed || 0) + 1,
        fixesAttempted: (latestMetric?.fixesAttempted || 0) + 1,
        fixesSucceeded: latestMetric?.fixesSucceeded || 0,
        avgProcessingTime: latestMetric?.avgProcessingTime || 0
      });

      res.json(issue);
    } catch (error) {
      console.error("Error processing Sentry webhook:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Add endpoint to manually trigger analysis
  app.post("/api/issues/:id/analyze", async (req, res) => {
    try {
      const issue = await storage.getIssue(parseInt(req.params.id));
      if (!issue) {
        return res.status(404).json({ message: "Issue not found" });
      }

      const fix = await issueAnalyzer.analyzeIssue(issue);
      res.json(fix);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}