import express from 'express';
import { GitHubService } from '../services/github';

const router = express.Router();
const githubService = new GitHubService();

router.post('/github', async (req, res) => {
  try {
    const { issueUrl } = req.body;
    
    if (!issueUrl) {
      return res.status(400).json({ error: 'Issue URL is required' });
    }

    const issue = await githubService.processIssueFromUrl(issueUrl);
    return res.json(issue);
  } catch (error) {
    console.error('Error processing GitHub issue:', error);
    return res.status(500).json({ error: 'Failed to process GitHub issue' });
  }
});

export default router; 