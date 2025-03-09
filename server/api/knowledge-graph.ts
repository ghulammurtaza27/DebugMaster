import { Router } from 'express';
import { githubService } from '../services/github';
import { knowledgeGraph } from '../services/knowledge-graph';
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

    // If no nodes found, return mock data
    if (nodes.length === 0) {
      console.log('No nodes found, returning mock data');
      
      // Create mock nodes and edges
      const mockNodes = [
        {
          id: '1',
          type: 'file',
          data: {
            name: 'index.js',
            content: 'import App from "./App";\n\nrender(<App />, document.getElementById("root"));',
            type: 'file'
          }
        },
        {
          id: '2',
          type: 'file',
          data: {
            name: 'App.js',
            content: 'import React from "react";\nimport Button from "./Button";\n\nfunction App() {\n  return <div><Button>Click me</Button></div>;\n}\n\nexport default App;',
            type: 'file'
          }
        },
        {
          id: '3',
          type: 'file',
          data: {
            name: 'Button.js',
            content: 'import React from "react";\n\nfunction Button({children}) {\n  return <button>{children}</button>;\n}\n\nexport default Button;',
            type: 'file'
          }
        },
        {
          id: '4',
          type: 'function',
          data: {
            name: 'App',
            content: 'function App() {\n  return <div><Button>Click me</Button></div>;\n}',
            type: 'function'
          }
        },
        {
          id: '5',
          type: 'function',
          data: {
            name: 'Button',
            content: 'function Button({children}) {\n  return <button>{children}</button>;\n}',
            type: 'function'
          }
        }
      ];
      
      const mockEdges = [
        {
          id: '1',
          source: '1',
          target: '2',
          type: 'imports',
          data: {
            relationship: 'imports',
            metadata: {}
          }
        },
        {
          id: '2',
          source: '2',
          target: '3',
          type: 'imports',
          data: {
            relationship: 'imports',
            metadata: {}
          }
        },
        {
          id: '3',
          source: '2',
          target: '4',
          type: 'contains',
          data: {
            relationship: 'contains',
            metadata: {}
          }
        },
        {
          id: '4',
          source: '3',
          target: '5',
          type: 'contains',
          data: {
            relationship: 'contains',
            metadata: {}
          }
        },
        {
          id: '5',
          source: '4',
          target: '5',
          type: 'calls',
          data: {
            relationship: 'calls',
            metadata: { arguments: 1 }
          }
        }
      ];
      
      console.log('Returning mock data with', mockNodes.length, 'nodes and', mockEdges.length, 'edges');
      return res.json({
        nodes: mockNodes,
        edges: mockEdges
      });
    }

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

    console.log('Returning transformed data with', transformedNodes.length, 'nodes and', transformedEdges.length, 'edges');
    res.json({
      nodes: transformedNodes,
      edges: transformedEdges
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

    // Check if mock mode is enabled
    const useMockGithub = process.env.USE_MOCK_GITHUB === "true";
    
    if (useMockGithub) {
      console.log('Using mock mode, skipping actual analysis');
      
      // Create mock nodes in the database
      try {
        // First clear any existing data
        await pool.query('DELETE FROM "code_edges"');
        await pool.query('DELETE FROM "code_nodes"');
        
        // Create mock nodes
        const mockFiles = [
          { path: 'index.js', type: 'file', name: 'index.js', content: 'import App from "./App";\n\nrender(<App />, document.getElementById("root"));' },
          { path: 'App.js', type: 'file', name: 'App.js', content: 'import React from "react";\nimport Button from "./Button";\n\nfunction App() {\n  return <div><Button>Click me</Button></div>;\n}\n\nexport default App;' },
          { path: 'Button.js', type: 'file', name: 'Button.js', content: 'import React from "react";\n\nfunction Button({children}) {\n  return <button>{children}</button>;\n}\n\nexport default Button;' }
        ];
        
        // Insert mock nodes
        for (const file of mockFiles) {
          await storage.createCodeNode(file);
        }
        
        // Get the inserted nodes to create edges
        const nodes = await storage.getCodeNodes();
        
        // Create edges between nodes
        if (nodes.length >= 3) {
          // index.js imports App.js
          await storage.createCodeEdge({
            sourceId: nodes[0].id,
            targetId: nodes[1].id,
            type: 'imports'
          });
          
          // App.js imports Button.js
          await storage.createCodeEdge({
            sourceId: nodes[1].id,
            targetId: nodes[2].id,
            type: 'imports'
          });
        }
        
        return res.json({ message: 'Mock analysis complete' });
      } catch (error) {
        console.error('Error creating mock data:', error);
        return res.status(500).json({ error: 'Failed to create mock data' });
      }
    }
    
    try {
      // Initialize GitHub service
      await githubService.initialize();
    } catch (error: any) {
      // Check if it's a rate limit error
      if (error.message && error.message.includes('rate limit')) {
        return res.status(429).json({ 
          error: error.message,
          rateLimitExceeded: true
        });
      }
      throw error;
    }

    // Build knowledge graph
    await knowledgeGraph.analyzeRepository(settings.githubOwner, settings.githubRepo);

    res.json({ message: 'Analysis complete' });
  } catch (error: any) {
    console.error('Error analyzing codebase:', error);
    
    // Check if it's a rate limit error
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