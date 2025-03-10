import { Router } from 'express';
import { githubService } from '../services/github';
import { knowledgeGraphService } from '../services/knowledge-graph';
import { storage } from '../storage';
import { pool } from '../db';

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

// Analyze the codebase and update the knowledge graph
router.post('/analyze', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    if (!settings) {
      return res.status(400).json({ error: 'GitHub settings not configured' });
    }

    try {
      // Initialize GitHub service
      await githubService.initialize();
    } catch (error: any) {
      if (error.message && error.message.includes('rate limit')) {
        return res.status(429).json({ 
          error: error.message,
          rateLimitExceeded: true
        });
      }
      throw error;
    }

    // Build knowledge graph
    await knowledgeGraphService.analyzeRepository(settings.githubOwner, settings.githubRepo);

    res.json({ message: 'Analysis complete' });
  } catch (error: any) {
    console.error('Error analyzing codebase:', error);
    
    if (error.message && error.message.includes('rate limit')) {
      return res.status(429).json({ 
        error: error.message,
        rateLimitExceeded: true
      });
    }
    
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to analyze codebase' });
  }
});

export default router; 