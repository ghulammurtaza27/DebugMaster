import express from 'express';
import { storage } from '../storage';
import { IntegrationManager } from '../services/integration-manager';
import { AIService } from '../services/ai-service';
import { GitHubService } from '../services/github';
import type { Issue } from '@shared/schema';

const router = express.Router();
const integrationManager = new IntegrationManager();
const aiService = new AIService();
const githubService = new GitHubService();

// Initialize services
integrationManager.setGitHubClient(githubService);

router.get('/', async (req, res) => {
  try {
    const issues = await storage.getIssues();
    res.json(issues);
  } catch (error) {
    console.error('Failed to get issues:', error);
    res.status(500).json({ error: 'Failed to get issues' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const issue = await storage.getIssue(parseInt(req.params.id));
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(issue);
  } catch (error) {
    console.error('Failed to get issue:', error);
    res.status(500).json({ error: 'Failed to get issue' });
  }
});

router.get('/:id/analysis', async (req, res) => {
  try {
    const issue = await storage.getIssue(parseInt(req.params.id));
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const analysis = await integrationManager.processIssue(issue);
    res.json(analysis);
  } catch (error) {
    console.error('Failed to get analysis:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
});

router.post('/:id/create-pr', async (req, res) => {
  try {
    const issue = await storage.getIssue(parseInt(req.params.id));
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Get the latest analysis
    const analysis = await integrationManager.processIssue(issue);
    if (!analysis.fix) {
      res.status(400).json({ error: 'No fix available for this issue' });
      return;
    }

    // Create the pull request
    const result = await integrationManager.createPullRequest(issue, analysis);
    res.json(result);
  } catch (error) {
    console.error('Failed to create pull request:', error);
    res.status(500).json({ error: 'Failed to create pull request' });
  }
});

export default router; 