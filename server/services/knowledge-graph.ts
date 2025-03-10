import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import { Node, ImportDeclaration } from "@babel/types";
import { storage } from "../storage";
import { InsertCodeNode, InsertCodeEdge } from "@shared/schema";
import fs from "fs/promises";
import * as path from 'path';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { Issue } from '@shared/schema';
import { githubService } from './github';
import { AIService } from './ai-service';
import { db, pool } from "../db";
import { codeNodes, codeEdges } from "@shared/schema";
import { sql } from "drizzle-orm";
import { IStorage } from '../storage';

interface FileInfo {
  path: string;
  line: number;
  column: number;
}

export class KnowledgeGraphService {
  private driver: Driver | null = null;
  private session: Session | null = null;
  private ai: AIService;
  private currentFilePath: string = '';
  private isNeo4jAvailable: boolean = true;
  private parser: any;
  private storage: IStorage;

  constructor(storage: IStorage) {
    console.log('Initializing KnowledgeGraphService...');
    this.storage = storage;
    
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'password';

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      this.session = this.driver.session();
      this.isNeo4jAvailable = true;
      console.log('Successfully connected to Neo4j');
    } catch (error) {
      console.warn('Failed to connect to Neo4j database. Using fallback mode.', error);
      this.isNeo4jAvailable = false;
    }
    
    this.ai = new AIService();

    try {
      console.log('Setting up Babel parser...');
      this.parser = {
        parse: (content: string) => {
          console.log('Parsing file with Babel...');
          try {
            const ast = parser.parse(content, {
              sourceType: 'module',
              plugins: ['typescript', 'jsx'],
              errorRecovery: true
            });
            console.log('Successfully parsed file with AST node count:', ast.program.body.length);
            return ast;
          } catch (parseError) {
            console.error('Error parsing file:', parseError);
            throw parseError;
          }
        },
        
        extractDeclarations: (ast: any, fileContent: string) => {
          console.log('Extracting declarations from AST...');
          const declarations: { type: string; name: string; content: string }[] = [];
          
          try {
            traverse(ast, {
              ClassDeclaration: (path: any) => {
                if (path.node.id?.name) {
                  console.log(`Found class declaration: ${path.node.id.name}`);
                  declarations.push({
                    type: 'class',
                    name: path.node.id.name,
                    content: fileContent.slice(path.node.start || 0, path.node.end || 0)
                  });
                }
              },
              FunctionDeclaration: (path: any) => {
                if (path.node.id?.name) {
                  console.log(`Found function declaration: ${path.node.id.name}`);
                  declarations.push({
                    type: 'function',
                    name: path.node.id.name,
                    content: fileContent.slice(path.node.start || 0, path.node.end || 0)
                  });
                }
              }
            });
            
            console.log(`Extracted ${declarations.length} declarations`);
            return declarations;
          } catch (traverseError) {
            console.error('Error traversing AST:', traverseError);
            throw traverseError;
          }
        }
      };
    } catch (initError) {
      console.error('Error initializing parser:', initError);
      throw initError;
    }
  }

  private async clearExistingGraph() {
    try {
      console.log('Clearing existing graph data...');
      
      // Use drizzle transaction instead of raw pool queries
      await db.transaction(async (tx) => {
        // First disable triggers to avoid foreign key constraint issues
        await tx.execute(sql`SET session_replication_role = replica`);
        
        // Delete edges first
        await tx.delete(codeEdges);
        console.log('Deleted all code edges');
        
        // Then delete nodes
        await tx.delete(codeNodes);
        console.log('Deleted all code nodes');
        
        // Re-enable triggers
        await tx.execute(sql`SET session_replication_role = DEFAULT`);
        
        console.log('Successfully cleared graph data');
      });
    } catch (error) {
      console.error('Error clearing existing graph:', error);
      throw error;
    }
  }

  async analyzeFile(filePath: string, owner?: string, repo?: string): Promise<void> {
    try {
      console.log(`\nAnalyzing file: ${filePath}`);
      
      let content: string;
      if (owner && repo) {
        // Get content from GitHub
        console.log('Fetching file content from GitHub...');
        const githubContent = await githubService.getFileContents({
          owner,
          repo,
          path: filePath
        });
        
        if (typeof githubContent !== 'string') {
          throw new Error('Expected file content but got directory listing');
        }
        content = githubContent;
      } else {
        // Read from local filesystem
        content = await fs.readFile(filePath, 'utf8');
      }
      
      console.log(`Successfully read file content (${content.length} bytes)`);
      
      // Create initial file node
      console.log('Creating file node...');
      try {
        const fileNode = await this.storage.createCodeNode({
          path: filePath,
          type: 'file',
          name: path.basename(filePath),
          content: content
        });
        console.log(`Created file node with ID: ${fileNode.id}`);
      } catch (dbError) {
        console.error('Failed to create file node in database:', dbError);
        throw dbError;
      }
      
      // Parse the file
      console.log('Parsing file content...');
      const ast = this.parser.parse(content);
      console.log('Successfully parsed file content');
      
      // Extract and create nodes for declarations
      console.log('Extracting declarations...');
      const declarations = this.parser.extractDeclarations(ast, content);
      console.log(`Found ${declarations.length} declarations`);
      
      for (const decl of declarations) {
        console.log(`Creating node for declaration: ${decl.name} (${decl.type})`);
        try {
          const node = await this.storage.createCodeNode({
            path: filePath,
            type: decl.type,
            name: decl.name,
            content: decl.content
          });
          console.log(`Created declaration node with ID: ${node.id}`);
        } catch (declError) {
          console.error(`Error creating node for declaration ${decl.name}:`, declError);
          // Continue with other declarations even if one fails
        }
      }
      
      console.log(`Completed analysis of file: ${filePath}\n`);
    } catch (error) {
      console.error(`Error analyzing file ${filePath}:`, error);
      if (error instanceof Error) {
        console.error('Stack trace:', error.stack);
      }
      throw error;
    }
  }

  private async processImport(fileNodeId: number, resolvedPath: string): Promise<void> {
    try {
      const importNode = await storage.createCodeNode({
        path: resolvedPath,
        type: 'file',
        name: path.basename(resolvedPath),
        content: '' // Don't store content for imported files
      });
      console.log(`Created import node with ID: ${importNode.id}`);

      await storage.createCodeEdge({
        sourceId: fileNodeId,
        targetId: importNode.id,
        type: 'imports',
        metadata: { importType: 'file' }
      });
      console.log(`Created edge: ${fileNodeId} imports ${importNode.id}`);
    } catch (error) {
      console.error(`Error processing import ${resolvedPath}:`, error);
      throw error; // Propagate the error up
    }
  }

  private async processClass(fileNodeId: number, className: string, content: string): Promise<void> {
    try {
      const classNode = await storage.createCodeNode({
        path: `${this.currentFilePath}#${className}`,
        type: 'class',
        name: className,
        content
      });
      console.log(`Created class node with ID: ${classNode.id}`);

      await storage.createCodeEdge({
        sourceId: fileNodeId,
        targetId: classNode.id,
        type: 'contains',
        metadata: { containsType: 'class' }
      });
      console.log(`Created edge: ${fileNodeId} contains ${classNode.id}`);
    } catch (error) {
      console.error(`Error processing class ${className}:`, error);
      throw error; // Propagate the error up
    }
  }

  private async processFunction(fileNodeId: number, functionName: string, content: string): Promise<void> {
    try {
      const functionNode = await storage.createCodeNode({
        path: `${this.currentFilePath}#${functionName}`,
        type: 'function',
        name: functionName,
        content
      });
      console.log(`Created function node with ID: ${functionNode.id}`);

      await storage.createCodeEdge({
        sourceId: fileNodeId,
        targetId: functionNode.id,
        type: 'contains',
        metadata: { containsType: 'function' }
      });
      console.log(`Created edge: ${fileNodeId} contains ${functionNode.id}`);
    } catch (error) {
      console.error(`Error processing function ${functionName}:`, error);
      throw error; // Propagate the error up
    }
  }

  private resolveImportPath(importPath: string, currentDir: string): string {
    return path.resolve(currentDir, importPath);
  }

  async buildProjectGraph(rootDir: string): Promise<void> {
    const files = await this.findTsFiles(rootDir);
    const settings = await this.storage.getSettings();
    if (!settings) {
      throw new Error('GitHub settings not configured');
    }
    
    for (const file of files) {
      await this.analyzeFile(file, settings.githubOwner, settings.githubRepo);
    }
  }

  private async findTsFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.findTsFiles(fullPath));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  async buildContext(issue: Issue) {
    try {
      // If Neo4j is not available, use a fallback approach
      if (!this.isNeo4jAvailable || !this.session) {
        console.log('Using fallback mode for knowledge graph context building');
        return this.buildFallbackContext(issue);
      }

      const session = this.session; // Create a local reference that TypeScript can track
      
      // Original Neo4j implementation
      // Create issue node
      await session.run(`
        CREATE (i:Issue {
          id: $id,
          title: $title,
          status: $status,
          stacktrace: $stacktrace
        })
      `, {
        id: issue.id.toString(),
        title: issue.title,
        status: issue.status,
        stacktrace: issue.stacktrace
      });

      // Extract and create file nodes from stacktrace
      const files = this.extractFilesFromStacktrace(issue.stacktrace);
      for (const file of files as FileInfo[]) {
        await this.createFileNode(file);
        await this.createRelationship('Issue', issue.id.toString(), 'File', file.path, 'AFFECTS');
      }

      // Create relationships between files based on imports
      await this.analyzeFileRelationships(files as FileInfo[]);

      // Return context for AI analysis
      return {
        files: await this.getRelatedFiles(issue.id.toString()),
        relationships: await this.getFileRelationships(issue.id.toString())
      };
    } catch (error) {
      console.error('Error building knowledge graph:', error);
      // If Neo4j operations fail, fall back to the simplified approach
      console.log('Falling back to simplified context building');
      return this.buildFallbackContext(issue);
    }
  }

  private extractFilesFromStacktrace(stacktrace: string): FileInfo[] {
    const fileRegex = /at\s+(?:\w+\s+\()?([\/\w\-\.]+\.[jt]sx?):(\d+):(\d+)/g;
    const files = new Set<FileInfo>();
    let match;

    while ((match = fileRegex.exec(stacktrace)) !== null) {
      files.add({
        path: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3])
      });
    }

    return Array.from(files);
  }

  private async createFileNode(file: FileInfo) {
    if (!this.session) {
      throw new Error('Neo4j session not available');
    }
    await this.session.run(`
      MERGE (f:File { path: $path })
      ON CREATE SET f.lines = $line, f.lastAccessed = timestamp()
      ON MATCH SET f.lastAccessed = timestamp()
    `, file);
  }

  private async createRelationship(
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    relationship: string
  ) {
    if (!this.session) {
      throw new Error('Neo4j session not available');
    }
    await this.session.run(`
      MATCH (source:${sourceType} { id: $sourceId })
      MATCH (target:${targetType} { path: $targetId })
      MERGE (source)-[r:${relationship}]->(target)
      ON CREATE SET r.created = timestamp()
    `, { sourceId, targetId });
  }

  private async analyzeFileRelationships(files: FileInfo[]) {
    if (!this.session) {
      throw new Error('Neo4j session not available');
    }
    // Create relationships between files based on imports and dependencies
    for (const file of files) {
      const content = await this.readFileContent(file.path);
      const imports = this.extractImports(content);
      
      for (const importPath of imports) {
        await this.createFileNode({ path: importPath, line: 0, column: 0 });
        await this.session.run(`
          MATCH (source:File { path: $sourcePath })
          MATCH (target:File { path: $targetPath })
          MERGE (source)-[r:IMPORTS]->(target)
        `, { sourcePath: file.path, targetPath: importPath });
      }
    }
  }

  private async readFileContent(filePath: string): Promise<string> {
    // Implement file reading logic
    // This should handle both local files and GitHub repository files
    return ''; // Placeholder
  }

  private extractImports(content: string): string[] {
    const importRegex = /import.*from\s+['"]([^'"]+)['"]/g;
    const imports = new Set<string>();
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.add(match[1]);
    }

    return Array.from(imports);
  }

  async storeFix(issue: Issue, fix: any) {
    try {
      if (!this.isNeo4jAvailable || !this.session) {
        console.log('Neo4j not available, skipping fix storage');
        return;
      }

      const session = this.session; // Create a local reference that TypeScript can track
      
      // Create fix node
      await session.run(`
        MATCH (i:Issue { id: $issueId })
        CREATE (f:Fix {
          id: $fixId,
          description: $description,
          createdAt: timestamp()
        })
        CREATE (i)-[r:HAS_FIX]->(f)
      `, {
        issueId: issue.id,
        fixId: `fix-${issue.id}`,
        description: fix.description
      });

      // Store file changes
      for (const change of fix.changes) {
        await session.run(`
          MATCH (f:Fix { id: $fixId })
          MATCH (file:File { path: $filePath })
          CREATE (c:Change {
            lineStart: $lineStart,
            lineEnd: $lineEnd,
            oldCode: $oldCode,
            newCode: $newCode
          })
          CREATE (f)-[r:CHANGES]->(c)
          CREATE (c)-[r2:AFFECTS]->(file)
        `, {
          fixId: `fix-${issue.id}`,
          filePath: change.file,
          ...change
        });
      }

      console.log(`Successfully stored fix for issue ${issue.id}`);
    } catch (error) {
      console.error('Error storing fix in knowledge graph:', error);
      throw error;
    }
  }

  async getRelatedFiles(issueId: string) {
    if (!this.isNeo4jAvailable || !this.session) {
      // Return empty array if Neo4j is not available
      return [];
    }
    
    const result = await this.session.run(`
      MATCH (i:Issue { id: $issueId })-[:AFFECTS]->(:File)<-[:IMPORTS*0..2]-(f:File)
      RETURN DISTINCT f.path as path
    `, { issueId });

    return result.records.map(record => record.get('path'));
  }

  async getFileRelationships(issueId: string) {
    if (!this.isNeo4jAvailable || !this.session) {
      console.log('Neo4j not available, returning empty relationships');
      return [];
    }
    
    try {
      const session = this.session; // Create a local reference that TypeScript can track
      const result = await session.run(`
        MATCH (i:Issue { id: $issueId })-[:AFFECTS]->(f:File)
        MATCH (f)-[r:IMPORTS|CONTAINS|CALLS]-(related:File)
        RETURN f.path as source, type(r) as relationship, related.path as target
      `, { issueId });

      return result.records.map(record => ({
        source: record.get('source'),
        relationship: record.get('relationship'),
        target: record.get('target')
      }));
    } catch (error) {
      console.error('Error getting file relationships:', error);
      return [];
    }
  }

  async close() {
    try {
      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      if (this.driver) {
        await this.driver.close();
        this.driver = null;
      }
      console.log('Successfully closed Neo4j connections');
    } catch (error) {
      console.error('Error closing Neo4j connections:', error);
    }
  }

  async analyzeRepository(owner: string, repo: string) {
    try {
      console.log(`Starting repository analysis for ${owner}/${repo}`);
      
      // Clear existing graph data
      await this.clearExistingGraph();
      console.log('Cleared existing graph data');
      
      // Get all files from the repository
      const files = await this.getAllRepositoryFiles(owner, repo);
      console.log(`Found ${files.length} files to analyze`);

      // Create a Set to track processed files and prevent duplicates
      const processedFiles = new Set<string>();
      
      // Process files in smaller batches
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        console.log(`\nProcessing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)}`);
        
        // Process each file in the batch sequentially to avoid transaction conflicts
        for (const file of batch) {
          // Skip if already processed or not analyzable
          if (processedFiles.has(file.path) || !this.isAnalyzableFile(file.path)) {
            console.log(`Skipping ${file.path} - ${processedFiles.has(file.path) ? 'already processed' : 'not analyzable'}`);
            continue;
          }
          
          try {
            console.log(`\nAttempting to analyze file ${i + batch.indexOf(file) + 1}/${files.length}: ${file.path}`);
            console.log('Fetching file contents...');
            const content = await githubService.getFileContents({
              owner,
              repo,
              path: file.path
            });

            if (typeof content === 'string') {
              console.log(`Retrieved content for ${file.path} (${content.length} characters)`);
              console.log('Starting file analysis...');
              await this.analyzeFile(file.path, owner, repo);
              processedFiles.add(file.path);
              
              // Log the current state after each file
              const nodes = await storage.getCodeNodes();
              const edges = await storage.getCodeEdges();
              console.log(`After analyzing ${file.path}:`);
              console.log(`- Total nodes in database: ${nodes.length}`);
              console.log(`- Total edges in database: ${edges.length}`);
              console.log(`- Node types:`, nodes.reduce((acc, node) => {
                acc[node.type] = (acc[node.type] || 0) + 1;
                return acc;
              }, {} as Record<string, number>));
            } else {
              console.warn(`Skipping ${file.path}: Expected file content but got directory listing`);
            }
          } catch (error) {
            console.error(`Error analyzing file ${file.path}:`, error);
            if (error instanceof Error) {
              console.error('Error stack:', error.stack);
            }
            // Continue with other files instead of failing the entire batch
          }
        }

        // Add a small delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`Progress: ${Math.min((i + batchSize), files.length)}/${files.length} files processed`);
      }

      // Final verification
      const nodes = await storage.getCodeNodes();
      console.log(`\nFinal verification: ${nodes.length} nodes exist in the database`);
      console.log('Node types:', nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>));
      
      return true;
    } catch (error) {
      console.error('Error analyzing repository:', error);
      throw error;
    }
  }

  private async getAllRepositoryFiles(owner: string, repo: string): Promise<Array<{ path: string }>> {
    try {
      console.log(`Getting all repository files for ${owner}/${repo}`);
      const response = await githubService.getFileContents({
        owner,
        repo,
        path: ''
      });

      if (!Array.isArray(response)) {
        throw new Error('Expected directory listing but got file content');
      }

      // Recursively get all files with concurrency control
      const files: Array<{ path: string }> = [];
      const queue: Array<{ path: string; type: string }> = response.map(item => ({ 
        path: item.path, 
        type: item.type 
      }));
      
      console.log(`Initial directory listing contains ${queue.length} items`);
      
      // Process files in batches to avoid rate limits
      const batchSize = 5;
      let processedCount = 0;
      
      while (queue.length > 0) {
        const batch = queue.splice(0, batchSize);
        await Promise.all(batch.map(async (item) => {
          processedCount++;
          if (processedCount % 20 === 0) {
            console.log(`Processed ${processedCount} items, ${queue.length} remaining in queue`);
          }
          
          if (item.type === 'file') {
            if (this.isAnalyzableFile(item.path)) {
              files.push({ path: item.path });
            }
          } else if (item.type === 'dir') {
            try {
              const contents = await githubService.getFileContents({
                owner,
                repo,
                path: item.path
              });

              if (Array.isArray(contents)) {
                queue.push(...contents.map(content => ({
                  path: content.path,
                  type: content.type
                })));
              }
            } catch (error) {
              console.warn(`Failed to get contents for directory ${item.path}:`, error);
              // Continue with other files
            }
          }
        }));

        // Add a small delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Found ${files.length} analyzable files in repository`);
      return files;
    } catch (error) {
      console.error('Error getting repository files:', error);
      throw error;
    }
  }

  private isAnalyzableFile(path: string): boolean {
    const analyzableExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const ignoredPaths = [
      'node_modules', 
      'dist', 
      'build', 
      '.git', 
      'test', 
      'tests', 
      '__tests__', 
      'e2e',
      'fixtures',
      'examples',
      'docs'
    ];
    const ignoredFiles = [
      '.test.',
      '.spec.',
      '.d.ts',
      '.min.',
      '.bundle.'
    ];
    
    // Skip files in ignored directories
    if (ignoredPaths.some(ignored => path.toLowerCase().includes(`/${ignored}/`))) {
      console.log(`Skipping ${path} - in ignored directory`);
      return false;
    }
    
    // Skip test and definition files
    if (ignoredFiles.some(pattern => path.toLowerCase().includes(pattern))) {
      console.log(`Skipping ${path} - ignored file pattern`);
      return false;
    }
    
    // Check if file has an analyzable extension
    const hasValidExtension = analyzableExtensions.some(ext => path.toLowerCase().endsWith(ext));
    if (!hasValidExtension) {
      console.log(`Skipping ${path} - not a JavaScript/TypeScript file`);
      return false;
    }
    
    console.log(`File ${path} is analyzable`);
    return true;
  }

  // New method to provide fallback functionality when Neo4j is unavailable
  private async buildFallbackContext(issue: Issue) {
    console.log('Building fallback context for issue analysis');
    
    // Extract files from stacktrace
    const files = this.extractFilesFromStacktrace(issue.stacktrace);
    const filePaths = files.map(file => file.path);
    
    // Simple relationships based on file paths
    const relationships = [];
    
    // If we have multiple files, create some basic relationships between them
    for (let i = 0; i < filePaths.length - 1; i++) {
      relationships.push({
        source: filePaths[i],
        relationship: 'RELATED_TO',
        target: filePaths[i + 1]
      });
    }
    
    return {
      files: filePaths,
      relationships: relationships
    };
  }
}

export const knowledgeGraphService = new KnowledgeGraphService(storage);