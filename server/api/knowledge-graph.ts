import { Router } from 'express';
import { githubService } from '../services/github';
import { knowledgeGraphService } from '../services/knowledge-graph';
import { storage } from '../storage';

const router = Router();

// Get the current knowledge graph
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/knowledge-graph - Fetching nodes and edges');
    const nodes = await storage.getCodeNodes();
    const edges = await storage.getCodeEdges();
    
    console.log(`Found ${nodes.length} nodes and ${edges.length} edges in the database`);

    // Transform the data for the frontend
    const transformedNodes = nodes.map(node => ({
      id: node.id.toString(),
      type: node.type,
      data: {
        name: node.name,
        content: node.content,
        type: node.type
      }
    }));

    const transformedEdges = edges.map(edge => ({
      id: edge.id.toString(),
      source: edge.sourceId.toString(),
      target: edge.targetId.toString(),
      type: edge.type,
      data: {
        relationship: edge.type,
        metadata: edge.metadata
      }
    }));

    // Get analysis status
    const isAnalyzing = await storage.getSettings().then(settings => {
      if (!settings) return false;
      return settings.githubOwner === process.env.GITHUB_OWNER && 
             settings.githubRepo === process.env.GITHUB_REPO;
    });

    console.log('Returning transformed data with', transformedNodes.length, 'nodes and', transformedEdges.length, 'edges');
    res.json({
      nodes: transformedNodes,
      edges: transformedEdges,
      isAnalyzing
    });
  } catch (error) {
    console.error('Error fetching knowledge graph:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge graph' });
  }
});

// Get edges
router.get('/edges', async (req, res) => {
  try {
    const edges = await storage.getCodeEdges();
    res.json(edges);
  } catch (error) {
    console.error('Error fetching edges:', error);
    res.status(500).json({ error: 'Failed to fetch edges' });
  }
});

// Analyze repository
router.post('/analyze', async (req, res) => {
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    
    console.log('GitHub Configuration:', {
      hasToken: !!token,
      tokenLength: token?.length || 0,
      owner,
      repo,
      envKeys: Object.keys(process.env).filter(key => key.startsWith('GITHUB_'))
    });
    
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo must be configured');
    }

    if (!token) {
      throw new Error('GitHub token not found in environment variables. Please check your .env file and server configuration.');
    }

    // Initialize GitHub service with token from environment
    console.log('Initializing GitHub service...');
    await githubService.initialize();
    
    // Test GitHub connection (no parameters needed as they're set in the service)
    console.log('Testing GitHub connection...');
    await githubService.testConnection();
    
    console.log(`Starting analysis of ${owner}/${repo}`);
    await knowledgeGraphService.analyzeRepository(owner, repo);
    res.json({ message: 'Analysis complete' });
  } catch (error) {
    console.error('Error analyzing repository:', error);
    if (error instanceof Error) {
      res.status(500).json({ 
        error: error.message,
        details: 'Failed to analyze repository. Please check GitHub token permissions and repository access.'
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to analyze repository',
        details: 'An unexpected error occurred during repository analysis.'
      });
    }
  }
});

export default router; 