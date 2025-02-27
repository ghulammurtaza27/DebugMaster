import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import { storage } from "../storage";
import { InsertCodeNode, InsertCodeEdge } from "@shared/schema";
import fs from "fs/promises";
import path from "path";

export class KnowledgeGraphService {
  async analyzeFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Create node for the file
    const fileNode = await storage.createCodeNode({
      path: filePath,
      type: 'file',
      name: path.basename(filePath),
      content: content
    });

    // Parse the file
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });

    // Track found nodes for creating edges
    const nodes: Map<string, number> = new Map();
    nodes.set(filePath, fileNode.id);

    // Traverse the AST
    traverse(ast, {
      ImportDeclaration: async (path) => {
        const importPath = path.node.source.value;
        // Create node for imported module
        const importNode = await storage.createCodeNode({
          path: importPath,
          type: 'file',
          name: path.basename(importPath),
          content: ''
        });

        // Create import edge
        await storage.createCodeEdge({
          sourceId: fileNode.id,
          targetId: importNode.id,
          type: 'imports',
          metadata: {
            specifiers: path.node.specifiers.map(s => s.local.name)
          }
        });
      },

      FunctionDeclaration: async (path) => {
        if (path.node.id) {
          // Create node for function
          const funcNode = await storage.createCodeNode({
            path: filePath,
            type: 'function',
            name: path.node.id.name,
            content: path.toString()
          });
          nodes.set(path.node.id.name, funcNode.id);
        }
      },

      CallExpression: async (path) => {
        if (path.node.callee.type === 'Identifier') {
          const calleeName = path.node.callee.name;
          const callerId = nodes.get(path.scope.path.node.id?.name || '');
          const calleeId = nodes.get(calleeName);

          if (callerId && calleeId) {
            // Create call edge
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
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.findTsFiles(fullPath));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }
}

export const knowledgeGraph = new KnowledgeGraphService();