import * as parser from "@babel/parser";
// Import traverse properly for ES modules
import traverseDefault from "@babel/traverse";
// @ts-ignore
const traverse = traverseDefault.default || traverseDefault;
// Log traverse to debug
console.log('traverse type:', typeof traverse);
console.log('traverse is function:', typeof traverse === 'function');

import type { NodePath } from "@babel/traverse";
import { Node, ImportDeclaration, ClassDeclaration, FunctionDeclaration, Identifier } from "@babel/types";
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

// Add Issue interface extension
interface ExtendedIssue extends Issue {
  description?: string;
}

// Add missing method to AIService interface
interface ExtendedAIService extends AIService {
  extractRelevantFiles(text: string): Promise<Array<{ path: string }>>;
}

interface BuildContextResult {
  files: Array<{ path: string; content: string; relevance: number }>;
  relationships: Array<{ source: string; relationship: string; target: string }>;
  metadata: Record<string, any>;
  projectStructure: {
    hierarchy: Record<string, string[]>;
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
    testCoverage: Record<string, any>;
  };
  dependencies: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
}

class KnowledgeGraphService {
  private driver: Driver | null = null;
  private ai: ExtendedAIService;
  private currentFilePath: string = '';
  private isNeo4jAvailable: boolean = true;
  private parser: any;
  private storage: IStorage;

  constructor(storage: IStorage) {
    console.log('Initializing KnowledgeGraphService...');
    this.storage = storage;
    this.ai = new AIService();
    
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'debug123';

    this.initializeNeo4j(uri, user, password);

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
            // Check if traverse is a function
            if (typeof traverse !== 'function') {
              console.error('traverse is not a function in extractDeclarations, type:', typeof traverse);
              throw new Error('traverse is not a function in extractDeclarations');
            }
            
            traverse(ast, {
              ClassDeclaration: (path: NodePath<ClassDeclaration>) => {
                if (path.node.id?.name) {
                  console.log(`Found class declaration: ${path.node.id.name}`);
                  declarations.push({
                    type: 'class',
                    name: path.node.id.name,
                    content: fileContent.slice(path.node.start || 0, path.node.end || 0)
                  });
                }
              },
              FunctionDeclaration: (path: NodePath<FunctionDeclaration>) => {
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

  private async initializeNeo4j(uri: string, user: string, password: string) {
    try {
        console.log('Connecting to Neo4j database...');
        this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
        
        // Verify connectivity
        await this.driver.verifyConnectivity();
        
        // Initialize constraints
        await this.initializeConstraints();
        
        this.isNeo4jAvailable = true;
        console.log('Successfully connected to Neo4j and initialized constraints');
    } catch (error) {
        console.error('Failed to connect to Neo4j database:', error);
        this.isNeo4jAvailable = false;
        this.driver = null;
    }
  }

  private async initializeConstraints() {
    if (!this.driver) {
        throw new Error('Neo4j driver not available');
    }
    
    const session = this.driver.session();
    try {
        // Create constraints for unique paths and IDs
        await session.run(`
            CREATE CONSTRAINT IF NOT EXISTS FOR (n:File)
            REQUIRE n.path IS UNIQUE
        `);
        
        await session.run(`
            CREATE CONSTRAINT IF NOT EXISTS FOR (n:Function)
            REQUIRE (n.path, n.name) IS UNIQUE
        `);
        
        await session.run(`
            CREATE CONSTRAINT IF NOT EXISTS FOR (n:Class)
            REQUIRE (n.path, n.name) IS UNIQUE
        `);
        
        console.log('Successfully created Neo4j constraints');
    } catch (error) {
        console.error('Error creating Neo4j constraints:', error);
        throw error;
    } finally {
        await session.close();
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
        
        // Verify Neo4j connection first
        if (!this.isNeo4jAvailable || !this.driver) {
            console.warn('Neo4j is not available, falling back to SQL storage only');
        } else {
            console.log('Neo4j connection verified');
        }
        
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
            // Create in Neo4j if available
            if (this.isNeo4jAvailable && this.driver) {
                // Create a new session for this operation
                const session = this.driver.session();
                try {
                    await session.run(`
                        MERGE (f:File {path: $path})
                        ON CREATE SET 
                            f.name = $name,
                            f.type = 'file',
                            f.createdAt = timestamp()
                        ON MATCH SET 
                            f.updatedAt = timestamp()
                        RETURN f
                    `, {
                        path: filePath,
                        name: path.basename(filePath)
                    });
                    console.log('Created file node in Neo4j');
                } finally {
                    // Always close the session
                    await session.close();
                }
            }
            
            // Create in SQL storage
            const fileNode = await this.storage.createCodeNode({
                path: filePath,
                type: 'file',
                name: path.basename(filePath),
                content: content
            });
            console.log(`Created file node with ID: ${fileNode.id}`);
        } catch (dbError) {
            console.error('Failed to create file node:', dbError);
            throw dbError;
        }
        
        // Parse the file
        console.log('Parsing file content...');
        const ast = this.parser.parse(content);
        console.log('Successfully parsed file content');
        
        // Extract and create nodes for declarations
        console.log('Extracting declarations...');
        try {
            // Use traverse with proper error handling
            if (typeof traverse !== 'function') {
                console.error('traverse is not a function, type:', typeof traverse);
                throw new Error('traverse is not a function');
            }
            
            // Store declarations to process
            const declarations: Array<{type: 'function' | 'class', name: string, content: string}> = [];
            const imports: Array<{path: string}> = [];
            
            traverse(ast, {
                FunctionDeclaration: (path: NodePath<FunctionDeclaration>) => {
                    const name = path.node.id?.name;
                    if (name) {
                        declarations.push({
                            type: 'function',
                            name,
                            content: content.slice(path.node.start!, path.node.end!)
                        });
                    }
                },
                ClassDeclaration: (path: NodePath<ClassDeclaration>) => {
                    const name = path.node.id?.name;
                    if (name) {
                        declarations.push({
                            type: 'class',
                            name,
                            content: content.slice(path.node.start!, path.node.end!)
                        });
                    }
                },
                ImportDeclaration: (path: NodePath<ImportDeclaration>) => {
                    const importPath = path.node.source.value;
                    imports.push({ path: importPath });
                }
            });
            
            // Process declarations
            for (const decl of declarations) {
                if (decl.type === 'function') {
                    await this.createFunctionNode(filePath, decl.name, decl.content);
                } else if (decl.type === 'class') {
                    await this.createClassNode(filePath, decl.name, decl.content);
                }
            }
            
            // Process imports
            for (const imp of imports) {
                await this.processImportNode(filePath, imp.path);
            }
        } catch (traverseError) {
            console.error('Error during traverse:', traverseError);
            throw traverseError;
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

  private async createFunctionNode(filePath: string, name: string, content: string) {
    try {
        // Create in Neo4j if available
        if (this.isNeo4jAvailable && this.driver) {
            // Create a new session for this operation
            const session = this.driver.session();
            try {
                await session.run(`
                    MATCH (f:File {path: $filePath})
                    MERGE (func:Function {path: $funcPath, name: $name})
                    ON CREATE SET 
                        func.content = $content,
                        func.createdAt = timestamp()
                    ON MATCH SET 
                        func.content = $content,
                        func.updatedAt = timestamp()
                    MERGE (f)-[r:CONTAINS]->(func)
                    RETURN func
                `, {
                    filePath,
                    funcPath: `${filePath}#${name}`,
                    name,
                    content
                });
                console.log(`Created function node in Neo4j: ${name}`);
            } finally {
                // Always close the session
                await session.close();
            }
        }
        
        // Create in SQL storage
        await this.storage.createCodeNode({
            path: `${filePath}#${name}`,
            type: 'function',
            name,
            content
        });
        console.log(`Created function node in SQL: ${name}`);
    } catch (error) {
        console.error(`Error creating function node ${name}:`, error);
        throw error;
    }
  }

  private async createClassNode(filePath: string, name: string, content: string) {
    try {
        // Create in Neo4j if available
        if (this.isNeo4jAvailable && this.driver) {
            // Create a new session for this operation
            const session = this.driver.session();
            try {
                await session.run(`
                    MATCH (f:File {path: $filePath})
                    MERGE (c:Class {path: $classPath, name: $name})
                    ON CREATE SET 
                        c.content = $content,
                        c.createdAt = timestamp()
                    ON MATCH SET 
                        c.content = $content,
                        c.updatedAt = timestamp()
                    MERGE (f)-[r:CONTAINS]->(c)
                    RETURN c
                `, {
                    filePath,
                    classPath: `${filePath}#${name}`,
                    name,
                    content
                });
                console.log(`Created class node in Neo4j: ${name}`);
            } finally {
                // Always close the session
                await session.close();
            }
        }
        
        // Create in SQL storage
        await this.storage.createCodeNode({
            path: `${filePath}#${name}`,
            type: 'class',
            name,
            content
        });
        console.log(`Created class node in SQL: ${name}`);
    } catch (error) {
        console.error(`Error creating class node ${name}:`, error);
        throw error;
    }
  }

  private async processImportNode(filePath: string, importPath: string) {
    try {
        const resolvedPath = this.resolveImportPath(importPath, path.dirname(filePath));
        
        // Create in Neo4j if available
        if (this.isNeo4jAvailable && this.driver) {
            // Create a new session for this operation
            const session = this.driver.session();
            try {
                await session.run(`
                    MATCH (f:File {path: $filePath})
                    MERGE (i:File {path: $importPath})
                    MERGE (f)-[r:IMPORTS]->(i)
                    ON CREATE SET r.createdAt = timestamp()
                    RETURN i
                `, {
                    filePath,
                    importPath: resolvedPath
                });
                console.log(`Created import relationship in Neo4j: ${filePath} -> ${resolvedPath}`);
            } finally {
                // Always close the session
                await session.close();
            }
        }
        
        // Create in SQL storage
        const sourceNode = await this.storage.createCodeNode({
            path: filePath,
            type: 'file',
            name: path.basename(filePath),
            content: ''
        });
        
        const targetNode = await this.storage.createCodeNode({
            path: resolvedPath,
            type: 'file',
            name: path.basename(resolvedPath),
            content: ''
        });
        
        await this.storage.createCodeEdge({
            sourceId: sourceNode.id,
            targetId: targetNode.id,
            type: 'imports',
            metadata: {}
        });
        console.log(`Created import relationship in SQL: ${filePath} -> ${resolvedPath}`);
    } catch (error) {
        console.error(`Error processing import ${importPath}:`, error);
        throw error;
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

  async buildContext(issue: ExtendedIssue): Promise<BuildContextResult> {
    console.log('Building context for issue:', issue.id);
    
    const context: BuildContextResult = {
      files: [],
      relationships: [],
      metadata: {},
      projectStructure: {
        hierarchy: {},
        dependencies: {},
        dependents: {},
        testCoverage: {}
      },
      dependencies: {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {}
      }
    };

    try {
      // 1. Extract files from stack trace with more detail
      const stackTraceFiles = this.extractFilesFromStacktrace(issue.stacktrace || '');
      
      // 2. Get files from issue description using AI with improved prompt
      const mentionedFiles = await this.ai.extractRelevantFiles(
        `${issue.title}\n${issue.description || ''}\n${issue.context?.codeSnippets?.join('\n') || ''}`
      );
      
      // 3. Get package.json and configuration files
      const configFiles = await this.getConfigurationFiles();
      
      // 4. Get all related files with smart prioritization
      const allFiles = new Set([
        ...stackTraceFiles.map(f => f.path),
        ...mentionedFiles.map(f => f.path),
        ...configFiles.map(f => f.path)
      ]);

      // 5. Build dependency graph
      const { dependencies, dependents } = await this.buildDependencyGraph(Array.from(allFiles));
      
      // 6. Get component hierarchy
      const componentHierarchy = await this.buildComponentHierarchy(Array.from(allFiles));

      // 7. Smart content extraction with priority
      for (const file of Array.from(allFiles)) {
        const content = await this.readFileContent(file);
        if (content) {
          const relevanceScore = this.calculateFileRelevance(file, {
            isStackTrace: stackTraceFiles.some(f => f.path === file),
            isMentioned: mentionedFiles.some(f => f.path === file),
            isConfig: configFiles.some(f => f.path === file),
            dependencyCount: (dependencies[file]?.length || 0),
            dependentCount: (dependents[file]?.length || 0)
          });

          const chunks = this.smartChunkContent(content, {
            maxChunks: relevanceScore > 0.8 ? 3 : 1,
            preferredSize: 1000
          });

          context.files.push(...chunks.map(chunk => ({
            path: file,
            content: chunk,
            relevance: relevanceScore
          })));
        }
      }

      // 8. Add test coverage information
      const testContext = await this.buildTestContext(Array.from(allFiles));
      
      // 9. Add project structure context
      context.projectStructure = {
        hierarchy: componentHierarchy,
        dependencies,
        dependents,
        testCoverage: testContext.coverage
      };

      // 10. Add package dependencies
      const packageInfo = await this.getPackageDependencies();
      context.dependencies = packageInfo;

      // Store metadata about the context
      context.metadata = {
        totalFiles: allFiles.size,
        stackTraceFiles: stackTraceFiles.length,
        mentionedFiles: mentionedFiles.length,
        testFiles: testContext.files.length,
        timestamp: new Date().toISOString(),
        description: issue.description || 'No description provided',
        repository: issue.context?.repository || 'Unknown',
        issueUrl: issue.context?.issueUrl || 'Unknown',
        labels: issue.context?.labels || [],
        githubMetadata: issue.context?.githubMetadata || null
      };
      
      // If no files were found, add some default context
      if (context.files.length === 0) {
        console.log('No files found, adding default context');
        
        // Create issue context file
        const issueContextFile = {
          path: 'issue-context.txt',
          content: `Issue Title: ${issue.title}\nRepository: ${issue.context?.repository || 'Unknown'}\nDescription: ${issue.description || 'No description provided'}`,
          relevance: 1.0
        };
        
        context.files.push(issueContextFile);
        console.log('Added issue context file:', issueContextFile.path);
        
        // Create repository info file if available
        if (issue.context?.repository) {
          const repoInfoFile = {
            path: 'repository-info.txt',
            content: `Repository: ${issue.context.repository}\nOwner: ${issue.context.githubMetadata?.owner || 'Unknown'}\nRepo: ${issue.context.githubMetadata?.repo || 'Unknown'}`,
            relevance: 0.8
          };
          
          context.files.push(repoInfoFile);
          console.log('Added repository info file:', repoInfoFile.path);
        }
        
        // Add code snippets as separate files if available
        if (issue.context?.codeSnippets && issue.context.codeSnippets.length > 0) {
          issue.context.codeSnippets.forEach((snippet, index) => {
            const snippetFile = {
              path: `code-snippet-${index + 1}.txt`,
              content: snippet,
              relevance: 0.9
            };
            
            context.files.push(snippetFile);
            console.log(`Added code snippet file: code-snippet-${index + 1}.txt`);
          });
        }
        
        console.log('Added default context files:', context.files.map(file => file.path));
      }

      return context;
    } catch (error) {
      console.error('Error building context:', error);
      return this.buildFallbackContext(issue);
    }
  }

  private extractFilesFromStacktrace(stacktrace: string): Array<{ path: string }> {
    const fileRegex = /\s+at\s+(?:\w+\s+\()?([^:)]+)(?::\d+:\d+)?/g;
    const files = new Set<string>();
    let match;

    while ((match = fileRegex.exec(stacktrace)) !== null) {
      const filePath = match[1];
      if (filePath && !filePath.includes('node_modules')) {
        files.add(filePath);
      }
    }

    return Array.from(files).map(filePath => ({ path: filePath }));
  }

  private async createFileNode(file: FileInfo) {
    if (!this.driver) {
        throw new Error('Neo4j driver not available');
    }

    try {
        console.log(`Creating/updating file node for path: ${file.path}`);
        
        // Create file node in Neo4j
        const session = this.driver.session();
        const result = await session.run(`
            MERGE (f:File { path: $path })
            ON CREATE SET 
                f.lines = $line,
                f.column = $column,
                f.createdAt = timestamp(),
                f.lastAccessed = timestamp()
            ON MATCH SET 
                f.lastAccessed = timestamp(),
                f.lines = $line,
                f.column = $column
            RETURN f
        `, {
            path: file.path,
            line: file.line || 0,
            column: file.column || 0
        });

        console.log(`Successfully created/updated file node in Neo4j: ${file.path}`);
        
        // Also create in SQL storage for redundancy
        await this.storage.createCodeNode({
            path: file.path,
            type: 'file',
            name: path.basename(file.path),
            content: ''  // Don't store content for now
        });
        
        return result.records[0].get('f').properties;
    } catch (error) {
        console.error(`Error creating file node for ${file.path}:`, error);
        throw error;
    }
  }

  private async createRelationship(
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    relationship: string,
    metadata: Record<string, any> = {}
  ) {
    if (!this.driver) {
        throw new Error('Neo4j driver not available');
    }

    try {
        console.log(`Creating relationship: (${sourceType}:${sourceId})-[${relationship}]->(${targetType}:${targetId})`);
        
        // Create relationship in Neo4j
        const session = this.driver.session();
        const result = await session.run(`
            MATCH (source:${sourceType} { id: $sourceId })
            MATCH (target:${targetType} { path: $targetId })
            MERGE (source)-[r:${relationship}]->(target)
            ON CREATE SET 
                r.created = timestamp(),
                r += $metadata
            ON MATCH SET 
                r += $metadata
            RETURN r
        `, { 
            sourceId,
            targetId,
            metadata
        });

        console.log('Successfully created relationship in Neo4j');
        
        // Also create in SQL storage for redundancy
        await this.storage.createCodeEdge({
            sourceId: parseInt(sourceId),
            targetId: parseInt(targetId),
            type: relationship,
            metadata
        });
        
        return result.records[0].get('r').properties;
    } catch (error) {
        console.error('Error creating relationship:', error);
        throw error;
    }
  }

  private async analyzeFileRelationships(files: FileInfo[]) {
    if (!this.driver) {
      throw new Error('Neo4j driver not available');
    }
    // Create relationships between files based on imports and dependencies
    for (const file of files) {
      const content = await this.readFileContent(file.path);
      const imports = this.extractImports(content);
      
      for (const importPath of imports) {
        await this.createFileNode({ path: importPath, line: 0, column: 0 });
        const session = this.driver.session();
        await session.run(`
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
      if (!this.isNeo4jAvailable || !this.driver) {
        console.log('Neo4j not available, skipping fix storage');
        return;
      }

      const session = this.driver.session();
      
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

  /**
   * Store analysis result even when no fix is proposed
   * This helps track what was analyzed and why no fix was generated
   */
  async storeAnalysisResult(issue: Issue, analysis: any) {
    try {
      if (!this.isNeo4jAvailable || !this.driver) {
        console.log('Neo4j not available, skipping analysis result storage');
        return;
      }

      const session = this.driver.session();
      
      // Create analysis node
      await session.run(`
        MERGE (i:Issue { id: $issueId })
        CREATE (a:Analysis {
          id: $analysisId,
          rootCause: $rootCause,
          severity: $severity,
          createdAt: timestamp()
        })
        CREATE (i)-[r:HAS_ANALYSIS]->(a)
      `, {
        issueId: issue.id,
        analysisId: `analysis-${issue.id}`,
        rootCause: analysis.rootCause || 'Unknown',
        severity: analysis.severity || 'medium'
      });

      // Store impacted components if available
      if (analysis.impactedComponents && analysis.impactedComponents.length > 0) {
        for (const component of analysis.impactedComponents) {
          await session.run(`
            MATCH (a:Analysis { id: $analysisId })
            MERGE (c:Component { name: $component })
            CREATE (a)-[r:IMPACTS]->(c)
          `, {
            analysisId: `analysis-${issue.id}`,
            component
          });
        }
      }

      // Store diagnostics if available
      if (analysis.diagnostics) {
        await session.run(`
          MATCH (a:Analysis { id: $analysisId })
          SET a.diagnostics = $diagnostics
        `, {
          analysisId: `analysis-${issue.id}`,
          diagnostics: JSON.stringify(analysis.diagnostics)
        });
      }

      console.log(`Successfully stored analysis result for issue ${issue.id}`);
      return true;
    } catch (error) {
      console.error('Error storing analysis result in knowledge graph:', error);
      // Don't throw error to avoid disrupting the main flow
      return false;
    }
  }

  async getRelatedFiles(issueId: string) {
    if (!this.isNeo4jAvailable || !this.driver) {
      // Return empty array if Neo4j is not available
      return [];
    }
    
    const result = await this.driver.session().run(`
      MATCH (i:Issue { id: $issueId })-[:AFFECTS]->(:File)<-[:IMPORTS*0..2]-(f:File)
      RETURN DISTINCT f.path as path
    `, { issueId });

    return result.records.map(record => record.get('path'));
  }

  async getFileRelationships(issueId: string) {
    if (!this.isNeo4jAvailable || !this.driver) {
      console.log('Neo4j not available, returning empty relationships');
      return [];
    }
    
    try {
      const session = this.driver.session();
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
      
      // Verify GitHub service is available
      if (!githubService) {
        throw new Error('GitHub service not available');
      }

      // Clear existing graph data
      await this.clearExistingGraph();
      console.log('Cleared existing graph data');
      
      // Get all files from the repository
      console.log('Fetching repository files...');
      const files = await this.getAllRepositoryFiles(owner, repo);
      console.log(`Found ${files.length} files to analyze`);

      // Create a Set to track processed files and prevent duplicates
      const processedFiles = new Set<string>();
      
      // Process files in smaller batches
      const batchSize = 10;
      let successfulFiles = 0;
      let failedFiles = 0;

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
            
            // Add retry logic for GitHub API calls
            let content;
            let retries = 3;
            while (retries > 0) {
              try {
                content = await githubService.getFileContents({
                  owner,
                  repo,
                  path: file.path
                });
                break;
              } catch (apiError) {
                retries--;
                if (retries === 0) throw apiError;
                console.log(`Retrying file fetch (${retries} attempts remaining)...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s between retries
              }
            }

            if (typeof content === 'string') {
              console.log(`Retrieved content for ${file.path} (${content.length} characters)`);
              console.log('Starting file analysis...');
              await this.analyzeFile(file.path, owner, repo);
              processedFiles.add(file.path);
              successfulFiles++;
              
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
            failedFiles++;
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
        console.log(`Success: ${successfulFiles}, Failed: ${failedFiles}`);
      }

      // Final verification
      const nodes = await storage.getCodeNodes();
      console.log(`\nFinal verification: ${nodes.length} nodes exist in the database`);
      console.log('Node types:', nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>));
      console.log(`Analysis complete. Successfully processed ${successfulFiles} files, failed to process ${failedFiles} files`);
      
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
  private buildFallbackContext(issue: ExtendedIssue): Promise<BuildContextResult> {
    console.log('Building fallback context for issue:', issue.id);
    
    // Create issue context file
    const issueContextFile = {
      path: 'issue-context.txt',
      content: `Issue Title: ${issue.title}\nRepository: ${issue.context?.repository || 'Unknown'}\nDescription: ${issue.description || 'No description provided'}`,
      relevance: 1.0
    };
    
    // Create repository info file if available
    const repoInfoFile = issue.context?.repository ? {
      path: 'repository-info.txt',
      content: `Repository: ${issue.context.repository}\nOwner: ${issue.context.githubMetadata?.owner || 'Unknown'}\nRepo: ${issue.context.githubMetadata?.repo || 'Unknown'}`,
      relevance: 0.8
    } : null;
    
    // Add code snippets as separate files if available
    const snippetFiles = (issue.context?.codeSnippets || []).map((snippet, index) => ({
      path: `code-snippet-${index + 1}.txt`,
      content: snippet,
      relevance: 0.9
    }));
    
    // Build the files array with all available context
    const files = [
      issueContextFile,
      ...(repoInfoFile ? [repoInfoFile] : []),
      ...snippetFiles
    ];
    
    console.log('Built fallback context with', files.length, 'files');
    
    return Promise.resolve({
      files,
      relationships: [],
      metadata: {
        error: 'Failed to build context with Neo4j',
        timestamp: new Date().toISOString(),
        description: issue.description || 'No description provided',
        repository: issue.context?.repository || 'Unknown',
        issueUrl: issue.context?.issueUrl || 'Unknown',
        labels: issue.context?.labels || [],
        githubMetadata: issue.context?.githubMetadata || null
      },
      projectStructure: {
        hierarchy: {},
        dependencies: {},
        dependents: {},
        testCoverage: {}
      },
      dependencies: {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {}
      }
    });
  }

  private async findRelatedTests(files: string[]): Promise<Array<{ path: string; content: string; relevance: number }>> {
    const testFiles: Array<{ path: string; content: string; relevance: number }> = [];
    
    for (const file of files) {
      // Convert source file path to potential test file path
      const testPath = file.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1');
      
      try {
        const content = await this.readFileContent(testPath);
        if (content) {
          testFiles.push({
            path: testPath,
            content,
            relevance: 0.7 // Tests are important but not as critical as source files
          });
        }
      } catch (error) {
        console.debug(`No test file found for ${file}`);
      }
    }
    
    return testFiles;
  }

  private smartChunkContent(content: string, options: { maxChunks: number; preferredSize: number } = { maxChunks: 1, preferredSize: 1000 }): string[] {
    if (!content) return [];

    // If content is smaller than preferred size, return as is
    if (content.length <= options.preferredSize) {
      return [content];
    }

    const chunks: string[] = [];
    let remainingContent = content;

    // Split content into chunks
    while (remainingContent.length > 0 && chunks.length < options.maxChunks) {
      // Find a good breaking point near the preferred size
      let breakPoint = options.preferredSize;
      
      // Try to break at a newline
      const newlineIndex = remainingContent.lastIndexOf('\n', options.preferredSize);
      if (newlineIndex > 0) {
        breakPoint = newlineIndex;
      }

      // Add chunk
      chunks.push(remainingContent.slice(0, breakPoint));
      remainingContent = remainingContent.slice(breakPoint).trim();
    }

    // If there's remaining content and we haven't hit max chunks
    if (remainingContent.length > 0 && chunks.length < options.maxChunks) {
      chunks.push(remainingContent);
    }

    return chunks;
  }

  private async getConfigurationFiles(): Promise<Array<{ path: string; content: string; relevance: number }>> {
    const configFiles = [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      '.env',
      '.eslintrc',
      'tailwind.config.js'
    ];
    
    const existingFiles: Array<{ path: string; content: string; relevance: number }> = [];
    for (const file of configFiles) {
      try {
        const content = await this.readFileContent(file);
        if (content) {
          existingFiles.push({
            path: file,
            content,
            relevance: 0.6 // Configuration files are important but not as critical as source files
          });
        }
      } catch (error) {
        console.debug(`Config file ${file} not found`);
      }
    }
    return existingFiles;
  }

  private async buildDependencyGraph(files: string[]): Promise<{
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
  }> {
    const dependencies: Record<string, string[]> = {};
    const dependents: Record<string, string[]> = {};
    
    for (const file of files) {
      try {
        const content = await this.readFileContent(file);
        if (!content) continue;

        const imports = this.extractImports(content);
        dependencies[file] = imports;
        
        for (const imp of imports) {
          if (!dependents[imp]) dependents[imp] = [];
          dependents[imp].push(file);
        }
      } catch (error) {
        console.warn(`Failed to build dependency graph for ${file}:`, error);
      }
    }
    
    return { dependencies, dependents };
  }

  private calculateFileRelevance(file: string, factors: {
    isStackTrace: boolean;
    isMentioned: boolean;
    isConfig: boolean;
    dependencyCount: number;
    dependentCount: number;
  }): number {
    let score = 0;
    
    if (factors.isStackTrace) score += 0.4;
    if (factors.isMentioned) score += 0.3;
    if (factors.isConfig) score += 0.1;
    
    // Normalize dependency scores
    const depScore = Math.min((factors.dependencyCount + factors.dependentCount) * 0.05, 0.2);
    score += depScore;
    
    return Math.min(score, 1);
  }

  private async buildTestContext(files: string[]) {
    const testFiles = await this.findRelatedTests(files);
    const coverage = await this.getTestCoverage(files);
    
    return {
      files: testFiles,
      coverage: coverage || {}
    };
  }

  private async buildComponentHierarchy(files: string[]): Promise<Record<string, string[]>> {
    const hierarchy: Record<string, string[]> = {};
    
    for (const file of files) {
      try {
        const content = await this.readFileContent(file);
        if (!content) continue;

        // Extract component relationships (imports, extensions, implementations)
        const relationships = await this.extractComponentRelationships(content);
        hierarchy[file] = relationships;
      } catch (error) {
        console.warn(`Failed to build component hierarchy for ${file}:`, error);
      }
    }

    return hierarchy;
  }

  private async extractComponentRelationships(content: string): Promise<string[]> {
    const relationships: string[] = [];
    
    // Extract class extensions
    const extendsRegex = /class\s+\w+\s+extends\s+(\w+)/g;
    let match;
    while ((match = extendsRegex.exec(content)) !== null) {
      relationships.push(match[1]);
    }

    // Extract interface implementations
    const implementsRegex = /class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([^{]+)/g;
    while ((match = implementsRegex.exec(content)) !== null) {
      const interfaces = match[1].split(',').map(i => i.trim());
      relationships.push(...interfaces);
    }

    return relationships;
  }

  private async getPackageDependencies(): Promise<{
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  }> {
    try {
      const content = await this.readFileContent('package.json');
      if (!content) return {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {}
      };

      const packageJson = JSON.parse(content);
      return {
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        peerDependencies: packageJson.peerDependencies || {}
      };
    } catch (error) {
      console.warn('Failed to get package dependencies:', error);
      return {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {}
      };
    }
  }

  private async getTestCoverage(files: string[]): Promise<Record<string, any>> {
    // This is a placeholder. In a real implementation, you would:
    // 1. Check if there's a coverage report file
    // 2. Parse it to get coverage data for the files
    // 3. Return structured coverage information
    return {};
  }

  /**
   * Get files for a repository from the knowledge graph
   * @param repository Repository in format "owner/repo"
   * @returns Array of files with path and content
   */
  async getRepositoryFiles(repository: string): Promise<Array<{ path: string; content: string; relevance: number }>> {
    console.log(`Getting files for repository: ${repository}`);
    
    if (!this.driver) {
      console.warn('Neo4j driver not initialized');
      return [];
    }
    
    const session = this.driver.session();
    
    try {
      // Query for files in the repository
      const result = await session.run(
        `MATCH (f:File) 
         WHERE f.repository = $repository
         RETURN f.path AS path, f.content AS content, f.size AS size
         ORDER BY f.size DESC
         LIMIT 10`,
        { repository }
      );
      
      const files = result.records.map(record => ({
        path: record.get('path'),
        content: record.get('content') || '',
        // Calculate relevance based on file size (smaller files are more relevant)
        relevance: 1 - Math.min(1, (record.get('size') || 0) / 100000)
      }));
      
      console.log(`Found ${files.length} files for repository ${repository}`);
      return files;
    } catch (error) {
      console.error(`Error getting files for repository ${repository}:`, error);
      return [];
    } finally {
      await session.close();
    }
  }
}
// Single export of the service instance
export const knowledgeGraphService = new KnowledgeGraphService(storage);
