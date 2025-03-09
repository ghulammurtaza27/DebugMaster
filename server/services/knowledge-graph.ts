import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import { Node, ImportDeclaration } from "@babel/types";
import { storage } from "../storage";
import { InsertCodeNode, InsertCodeEdge } from "@shared/schema";
import fs from "fs/promises";
import nodePath from "path";
import neo4j, { Driver, Session } from 'neo4j-driver';
import { Issue } from '@shared/schema';
import { githubService } from './github';
import { AIService } from './ai-service';
import { db, pool } from "../db";
import { codeNodes, codeEdges } from "@shared/schema";
import { sql } from "drizzle-orm";

interface FileInfo {
  path: string;
  line: number;
  column: number;
}

export class KnowledgeGraphService {
  private driver: Driver;
  private session: Session;
  private ai: AIService;
  private currentFilePath: string = '';

  constructor() {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'password';

    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    this.session = this.driver.session();
    this.ai = new AIService();
  }

  private async clearExistingGraph() {
    try {
      // Use a more specific query to delete edges where source_id = 3 (the problematic one)
      await pool.query('DELETE FROM "code_edges" WHERE source_id = 3 OR target_id = 3');
      
      // Then delete all other edges
      await pool.query('DELETE FROM "code_edges"');
      
      // Finally delete all nodes
      await pool.query('DELETE FROM "code_nodes"');
    } catch (error) {
      console.error('Error clearing existing graph:', error);
      throw error;
    }
  }

  async analyzeFile(path: string, content?: string): Promise<void> {
    try {
      this.currentFilePath = path;
      
      // If content is not provided, read it from the file
      const fileContent = content || await fs.readFile(path, 'utf-8');
      
      // Parse the file
      const ast = parser.parse(fileContent, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx']
      });

      // Create a node for the file
      const fileNode = await storage.createCodeNode({
        path,
        type: 'file',
        name: path.split('/').pop() || path,
        content: fileContent
      });

      // Track found nodes for creating edges
      const nodes: Map<string, number> = new Map();
      nodes.set(path, fileNode.id);

      // Analyze the AST
      traverse(ast, {
        ClassDeclaration: async (path) => {
          const className = path.node.id?.name;
          if (className) {
            const classNode = await storage.createCodeNode({
              path: `${this.currentFilePath}#${className}`,
              type: 'class',
              name: className,
              content: fileContent.slice(path.node.start || 0, path.node.end || 0)
            });

            await storage.createCodeEdge({
              sourceId: fileNode.id,
              targetId: classNode.id,
              type: 'contains'
            });
            nodes.set(className, classNode.id);
          }
        },

        FunctionDeclaration: async (path) => {
          const functionName = path.node.id?.name;
          if (functionName) {
            const functionNode = await storage.createCodeNode({
              path: `${this.currentFilePath}#${functionName}`,
              type: 'function',
              name: functionName,
              content: fileContent.slice(path.node.start || 0, path.node.end || 0)
            });

            await storage.createCodeEdge({
              sourceId: fileNode.id,
              targetId: functionNode.id,
              type: 'contains'
            });
            nodes.set(functionName, functionNode.id);
          }
        },

        ImportDeclaration: async (path) => {
          const importPath = path.node.source.value;
          if (importPath.startsWith('.')) {
            const resolvedPath = this.resolveImportPath(importPath, nodePath.dirname(this.currentFilePath));
            const importNode = await storage.createCodeNode({
              path: resolvedPath,
              type: 'file',
              name: nodePath.basename(resolvedPath),
              content: ''
            });

            await storage.createCodeEdge({
              sourceId: fileNode.id,
              targetId: importNode.id,
              type: 'imports'
            });
          }
        },

        CallExpression: async (path) => {
          if (path.node.callee.type === 'Identifier') {
            const calleeName = path.node.callee.name;
            const currentFunction = path.findParent((p) => p.isFunctionDeclaration());
            const functionNode = currentFunction?.node as Node & { id?: { name: string } };
            const callerId = functionNode?.id?.name 
              ? nodes.get(functionNode.id.name)
              : undefined;
            const calleeId = nodes.get(calleeName);

            if (callerId && calleeId) {
              await storage.createCodeEdge({
                sourceId: callerId,
                targetId: calleeId,
                type: 'calls',
                metadata: {
                  arguments: path.node.arguments.length
                }
              });
            }
          }
        }
      });

    } catch (error) {
      console.error(`Error analyzing file ${path}:`, error);
    }
  }

  private resolveImportPath(importPath: string, currentDir: string): string {
    return nodePath.resolve(currentDir, importPath);
  }

  async buildProjectGraph(rootDir: string): Promise<void> {
    const files = await this.findTsFiles(rootDir);
    for (const file of files) {
      await this.analyzeFile(file);
    }
  }

  private async findTsFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = nodePath.join(dir, entry.name);
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
      // Create issue node
      await this.session.run(`
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
      throw error;
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
    await this.session.run(`
      MATCH (source:${sourceType} { id: $sourceId })
      MATCH (target:${targetType} { path: $targetId })
      MERGE (source)-[r:${relationship}]->(target)
      ON CREATE SET r.created = timestamp()
    `, { sourceId, targetId });
  }

  private async analyzeFileRelationships(files: FileInfo[]) {
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
      // Create fix node
      await this.session.run(`
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
        await this.session.run(`
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
    } catch (error) {
      console.error('Error storing fix in knowledge graph:', error);
      throw error;
    }
  }

  async getRelatedFiles(issueId: string) {
    const result = await this.session.run(`
      MATCH (i:Issue { id: $issueId })-[:AFFECTS]->(:File)<-[:IMPORTS*0..2]-(f:File)
      RETURN DISTINCT f.path as path
    `, { issueId });

    return result.records.map(record => record.get('path'));
  }

  async getFileRelationships(issueId: string) {
    const result = await this.session.run(`
      MATCH (i:Issue { id: $issueId })-[:AFFECTS]->(f:File)
      MATCH (f)-[r:IMPORTS*0..2]-(related:File)
      RETURN f.path as source, type(r) as relationship, related.path as target
    `, { issueId });

    return result.records.map(record => ({
      source: record.get('source'),
      relationship: record.get('relationship'),
      target: record.get('target')
    }));
  }

  async close() {
    await this.session.close();
    await this.driver.close();
  }

  async analyzeRepository(owner: string, repo: string) {
    try {
      // Get all files from the repository
      const files = await this.getAllRepositoryFiles(owner, repo);

      // Clear existing graph data
      await this.clearExistingGraph();

      // Process each file
      for (const file of files) {
        if (this.isAnalyzableFile(file.path)) {
          try {
            const content = await githubService.getFileContents({
              owner,
              repo,
              path: file.path
            });

            if (typeof content === 'string') {
              await this.analyzeFile(file.path, content);
            } else {
              console.warn(`Skipping ${file.path}: Expected file content but got directory listing`);
            }
          } catch (error) {
            console.error(`Error analyzing file ${file.path}:`, error);
            // Continue with other files
            continue;
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Error analyzing repository:', error);
      throw error;
    }
  }

  private async getAllRepositoryFiles(owner: string, repo: string): Promise<Array<{ path: string }>> {
    try {
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
      
      // Process files in batches to avoid rate limits
      const batchSize = 5;
      while (queue.length > 0) {
        const batch = queue.splice(0, batchSize);
        await Promise.all(batch.map(async (item) => {
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

      return files;
    } catch (error) {
      console.error('Error getting repository files:', error);
      throw error;
    }
  }

  private isAnalyzableFile(path: string): boolean {
    const analyzableExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const ignoredPaths = ['node_modules', 'dist', 'build', '.git'];
    
    // Skip files in ignored directories
    if (ignoredPaths.some(ignored => path.includes(`/${ignored}/`))) {
      return false;
    }
    
    return analyzableExtensions.some(ext => path.endsWith(ext));
  }
}

export const knowledgeGraph = new KnowledgeGraphService();