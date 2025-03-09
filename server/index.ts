import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import 'dotenv/config';
// or
import * as dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubService } from "./services/github";
import knowledgeGraphRouter from './api/knowledge-graph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env file from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('DATABASE_URL from index:', process.env.DATABASE_URL);

const app = express();

// Update CORS configuration
app.use(cors({
  origin: 'http://localhost:5173', // Only allow the Vite dev server origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Explicitly allow methods
  allowedHeaders: ['Content-Type'], // Explicitly allow headers
}));

// Make sure these come after CORS
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Add setupAuth before routes
setupAuth(app);

// Add GitHub routes here, before the logging middleware
const githubService = new GitHubService();
app.post("/api/issues/github", async (req, res) => {
  try {
    const { issueUrl } = req.body;

    if (!issueUrl) {
      return res.status(400).json({ error: "Issue URL is required" });
    }

    const issue = await githubService.processIssueFromUrl(issueUrl);
    return res.json(issue);
  } catch (error) {
    console.error("Error processing GitHub issue:", error);
    return res.status(500).json({ error: "Failed to process GitHub issue" });
  }
});

// Add routes
app.use('/api/knowledge-graph', knowledgeGraphRouter);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();