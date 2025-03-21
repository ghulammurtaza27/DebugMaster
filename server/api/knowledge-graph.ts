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
    // Get settings from database
    const settings = await storage.getSettings();
    if (!settings) {
      throw new Error('GitHub settings not configured in database');
    }

    console.log('GitHub Configuration:', {
      hasToken: !!settings.githubToken,
      tokenLength: settings.githubToken?.length || 0,
      owner: settings.githubOwner,
      repo: settings.githubRepo
    });
    
    if (!settings.githubOwner || !settings.githubRepo) {
      throw new Error('GitHub owner and repo must be configured in database');
    }

    if (!settings.githubToken) {
      throw new Error('GitHub token not found in database settings');
    }

    // Initialize GitHub service (it will get settings from database)
    console.log('Initializing GitHub service...');
    await githubService.initialize();
    
    // Test GitHub connection
    console.log('Testing GitHub connection...');
    await githubService.testConnection();
    
    console.log(`Starting analysis of ${settings.githubOwner}/${settings.githubRepo}`);
    await knowledgeGraphService.analyzeRepository(settings.githubOwner, settings.githubRepo);
    res.json({ message: 'Analysis complete' });
  } catch (error) {
    console.error('Error analyzing repository:', error);
    if (error instanceof Error) {
      res.status(500).json({ 
        error: error.message,
        details: 'Failed to analyze repository. Please check GitHub settings in database.'
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