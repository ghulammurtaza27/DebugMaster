import { Issue } from '@shared/schema';
import { storage } from '../storage';
import { githubService } from './github';
import { knowledgeGraphService } from './knowledge-graph';
import type { AIService as ImportedAIService } from './ai-service';
import * as ts from 'typescript';
import { ESLint } from 'eslint';
import { InsertMetric } from '@shared/schema';

interface FileContextItem {
  path: string;
  content: string;
  relevance: number;
}

interface AnalyzeOptions {
  skipBranchCreation?: boolean;
}

interface AnalysisResult {
  codeSnippets: string[];
  stackTrace: string;
  status: string;
  analysis: {
    rootCause: string;
    severity: 'high' | 'medium' | 'low';
    impactedComponents: string[];
    suggestedFix?: {
      files: Array<{
        path: string;
        changes: Array<{
          lineStart: number;
          lineEnd: number;
          oldCode: string;
          newCode: string;
          explanation: string;
        }>;
      }>;
    };
  };
  relatedFiles: string[];
  dependencies: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

interface ValidationIssue {
  file: string;
  message: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}

interface FileChange {
  file: string;
  newCode: string;
}

interface BuildContextResult {
  files: Array<{ path: string; content: string; relevance: number }>;
  relationships: Array<{ source: string; relationship: string; target: string }>;
  metadata: {
    totalFiles: number;
    stackTraceFiles: number;
    mentionedFiles: number;
    testFiles: number;
    timestamp: string;
    description: string;
    repository: string;
    issueUrl: string;
    labels: string[];
    githubMetadata: Record<string, unknown> | null;
  };
  projectStructure: {
    hierarchy: Record<string, string[]>;
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
    testCoverage: Record<string, unknown>;
  };
  dependencies: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
}

interface ExtendedIssue extends Issue {
  description?: string;
}

interface ProjectContext {
  projectStructure: {
    hierarchy: Record<string, string[]>;
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
    testCoverage: Record<string, unknown>;
  };
  dependencies: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
}

interface AIServiceParams {
  stacktrace: string;
  codeSnippets: string[];
  fileContext: FileContextItem[];
  issueDescription: string;
  projectContext?: ProjectContext;
}

interface AIServiceResult {
  rootCause: string;
  severity: 'high' | 'medium' | 'low';
  impactedComponents: string[];
  fix?: {
    changes: Array<{
      file: string;
      changes: Array<{
        lineStart: number;
        lineEnd: number;
        oldCode: string;
        newCode: string;
        explanation: string;
      }>;
    }>;
  };
}




export class IssueAnalyzer {
  private ai: ImportedAIService;
  private eslint: ESLint;

  constructor() {
    this.ai = new (require('./ai-service').AIService)();
    this.eslint = new ESLint({
      baseConfig: {},
      fix: false
    });
  }

  async analyzeIssue(issue: Issue, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    try {
      // Cast issue to ExtendedIssue to handle description
      const extendedIssue = issue as ExtendedIssue;
      
      // Update issue status
      await storage.updateIssueStatus(
        typeof extendedIssue.id === 'string' ? parseInt(extendedIssue.id) : extendedIssue.id,
        'analyzing'
      );

      // Build knowledge graph context
      const graphContext = await knowledgeGraphService.buildContext(extendedIssue);
      console.log('Knowledge graph context built with', graphContext.files.length, 'files');
      
      // Extract code snippets and stack trace
      const codeSnippets = extendedIssue.context?.codeSnippets || [];
      const stackTrace = extendedIssue.stacktrace || '';

      // Get related files and their content
      const filesToAnalyze = graphContext.files || [];
      console.log('Files to analyze:', filesToAnalyze.map(file => typeof file === 'object' ? file.path : file));
      
      // Create a map of file paths to their contents for easy lookup
      const fileContentsMap = new Map<string, string>();
      for (const file of filesToAnalyze) {
        if (file.content) {
          fileContentsMap.set(file.path, file.content);
        }
      }

      // Extract files mentioned in backticks from the description
      const mentionedFiles = (extendedIssue.description || '')
        .match(/`[^`]+`/g)
        ?.map((f: string) => f.replace(/`/g, ''))
        .filter((path: string) => path.includes('/')) || [];

      // Create placeholder content for mentioned files
      for (const filePath of mentionedFiles) {
        if (!fileContentsMap.has(filePath)) {
          console.log(`Creating placeholder content for file: ${filePath}`);
          
          // Generate placeholder content based on file type and issue description
          const fileExt = filePath.split('.').pop()?.toLowerCase();
          const isTypeScript = fileExt === 'ts' || fileExt === 'tsx';
          const isAPI = filePath.includes('/api/');
          
          const placeholderContent = `// Generated placeholder for ${filePath}
// Based on issue description:
/*
${extendedIssue.description || 'No description provided'}
*/

${isTypeScript ? `export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    '/node_modules/oauth/**',
    '/node_modules/google-auth-library/**'
  ]
};

import { type NextRequest } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { getSession } from 'next-auth/react';

const MAX_REFRESH_ATTEMPTS = 3;
const REFRESH_RETRY_DELAY = 1000; // ms

interface TokenError {
  type: 'auth' | 'api' | 'network';
  message: string;
  retryable: boolean;
}

class TokenManager {
  private static instance: TokenManager;
  private refreshAttempts: Map<string, number> = new Map();
  
  private constructor() {}
  
  static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  async refreshToken(oauth2Client: OAuth2Client): Promise<void> {
    const clientId = oauth2Client._clientId;
    const attempts = this.refreshAttempts.get(clientId) || 0;
    
    if (attempts >= MAX_REFRESH_ATTEMPTS) {
      throw this.createError('auth', 'Max refresh attempts exceeded', false);
    }
    
    this.refreshAttempts.set(clientId, attempts + 1);
    
    try {
      await oauth2Client.refreshAccessToken();
      // Reset attempts on success
      this.refreshAttempts.delete(clientId);
    } catch (error) {
      throw this.createError('auth', 'Token refresh failed', attempts < MAX_REFRESH_ATTEMPTS);
    }
  }
  
  private createError(type: TokenError['type'], message: string, retryable: boolean): TokenError {
    return { type, message, retryable };
  }
  
  clearTokenData(clientId: string): void {
    this.refreshAttempts.delete(clientId);
  }
}

async function handleRequest(req: NextRequest) {
  const session = await getSession({ req });
  if (!session?.accessToken) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'No access token found' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  
  const tokenManager = TokenManager.getInstance();
  
  try {
    // Your API logic here
    throw new Error('Not implemented');
  } catch (error) {
    if (error.message === 'invalid_grant' || error.message === 'invalid_token') {
      try {
        await tokenManager.refreshToken(oauth2Client);
        // Retry the original request
        return handleRequest(req);
      } catch (refreshError) {
        if (!refreshError.retryable) {
          tokenManager.clearTokenData(oauth2Client._clientId);
          return new Response(
            JSON.stringify({ 
              error: 'Authentication failed',
              message: 'Please sign in again'
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // If retryable, throw to trigger another attempt
        throw refreshError;
      }
    }
    throw error;
  }
}

export async function GET(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (error) {
    const status = error.type === 'auth' ? 401 : 
                   error.type === 'api' ? 400 : 500;
                   
    return new Response(
      JSON.stringify({ 
        error: error.type || 'unknown',
        message: error.message || 'An unexpected error occurred'
      }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}` : '// Implementation would go here'}`;
          
          // Add the placeholder file to both the map and the files to analyze
          fileContentsMap.set(filePath, placeholderContent);
          filesToAnalyze.push({
            path: filePath,
            content: placeholderContent,
            relevance: 1.0 // High relevance for explicitly mentioned files
          });
          
          // Also add to the knowledge graph context
          graphContext.files.push({
            path: filePath,
            content: placeholderContent,
            relevance: 1.0
          });
        }
      }

      // Get related files content with placeholder handling
      const relatedFilesContent = await this.getRelatedFilesContent(filesToAnalyze);
      console.log('Retrieved', relatedFilesContent.length, 'related files');

      // Prepare analysis input with detailed file context
      const analysisInput = {
        stacktrace: stackTrace,
        codeSnippets,
        fileContext: relatedFilesContent,
        issueDescription: extendedIssue.description || '',
        projectContext: {
          projectStructure: graphContext.projectStructure,
          dependencies: graphContext.dependencies
        }
      };
      console.log('AI analysis input:', analysisInput);

      // Get AI analysis with enhanced context
      const analysis = await this.ai.analyzeBug(analysisInput);

      // Store analysis result
      await knowledgeGraphService.storeAnalysisResult(extendedIssue, analysis);

      // Generate fixes if analysis suggests them
      let suggestedFix;
      if (analysis.fix) {
        const fixes = await this.generateFixesFromAnalysis(analysis.fix, relatedFilesContent);
        if (fixes) {
          suggestedFix = fixes;
          await knowledgeGraphService.storeFix(extendedIssue, fixes);
        }
      }

      // Update issue status
      await storage.updateIssueStatus(
        typeof extendedIssue.id === 'string' ? parseInt(extendedIssue.id) : extendedIssue.id,
        'analyzed'
      );

      // Return complete analysis result
      return {
        codeSnippets,
        stackTrace,
        status: 'analyzed',
        analysis: {
          rootCause: analysis.rootCause,
          severity: analysis.severity,
          impactedComponents: analysis.impactedComponents,
          suggestedFix
        },
        relatedFiles: relatedFilesContent.map(f => f.path),
        dependencies: graphContext.relationships.map(r => ({
          source: r.source,
          target: r.target,
          type: r.relationship
        }))
      };
    } catch (error) {
      console.error('Failed to analyze issue:', error);
      await storage.updateIssueStatus(
        typeof issue.id === 'string' ? parseInt(issue.id) : issue.id,
        'analysis_failed'
      );
      throw error;
    }
  }

  private async getRelatedFilesContent(files: Array<{ path: string; content: string; relevance: number }>): Promise<Array<{ path: string; content: string; relevance: number }>> {
    const result: Array<{ path: string; content: string; relevance: number }> = [];
    
    for (const file of files) {
      try {
        // If the file already has content, use it
        if (file.content) {
          result.push({
            path: file.path,
            content: file.content,
            relevance: file.relevance
          });
          continue;
        }

        // Otherwise try to fetch from GitHub
        const settings = await storage.getSettings();
        if (!settings) {
          throw new Error('GitHub settings not configured');
        }

        const content = await githubService.getFileContents({
          owner: settings.githubOwner,
          repo: settings.githubRepo,
          path: file.path
        });
        
        if (typeof content === 'string') {
          result.push({
            path: file.path,
            content,
            relevance: file.relevance
          });
        } else {
          console.warn(`No content found for file: ${file.path}`);
        }
      } catch (error) {
        console.warn(`Error getting content for file ${file.path}:`, error);
      }
    }

    return result;
  }

  private async validateProposedChange(change: FileChange): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    try {
      // Get settings first to access owner and repo
      const settings = await storage.getSettings();
      if (!settings) {
        throw new Error('GitHub settings not configured');
      }

      // Check if file exists first
      let originalContent: string | null = null;
      try {
        const content = await githubService.getFileContents({
          owner: settings.githubOwner,
          repo: settings.githubRepo,
          path: change.file
        });
        originalContent = typeof content === 'string' ? content : JSON.stringify(content);
      } catch (error: any) {
        if (error.status === 404) {
          // File doesn't exist, treat as new file
          return {
            isValid: true,
            issues: []
          };
        }
        throw error;
      }
      
      // If file exists, validate the change using AI
      if (originalContent) {
        const validation = await this.ai.validateFix(
          originalContent,
          change.newCode
        );

        // Additional static analysis
        const staticAnalysisIssues = await this.performStaticAnalysis(change.newCode);
        
        return {
          isValid: validation.isValid && staticAnalysisIssues.length === 0,
          issues: [...validation.issues, ...staticAnalysisIssues]
        };
      }

      return {
        isValid: true,
        issues: []
      };
    } catch (error) {
      console.error('Validation failed:', error);
      return {
        isValid: false,
        issues: ['Validation failed due to technical error']
      };
    }
  }

  private async performStaticAnalysis(code: string): Promise<string[]> {
    const issues: string[] = [];

    try {
      // 1. Syntax validation
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // 2. Type checking
      const compilerOptions: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext
      };

      const program = ts.createProgram(['temp.ts'], compilerOptions);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      for (const diagnostic of diagnostics) {
        if (diagnostic.file && diagnostic.start !== undefined) {
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          issues.push(
            `Type error at ${line + 1}:${character + 1} - ${ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n'
            )}`
          );
        }
      }

      // 3. ESLint validation
      const lintResults = await this.eslint.lintText(code);
      for (const result of lintResults) {
        for (const msg of result.messages) {
          issues.push(`${msg.severity === 2 ? 'Error' : 'Warning'} at ${msg.line}:${msg.column} - ${msg.message}`);
        }
      }

      // 4. Security checks
      const securityIssues = await this.performSecurityChecks(code);
      issues.push(...securityIssues);

    } catch (error) {
      issues.push(`Static analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return issues;
  }

  private async performSecurityChecks(code: string): Promise<string[]> {
    const issues: string[] = [];
    
    // Check for common security issues
    const securityPatterns = [
      {
        pattern: /eval\s*\(/,
        message: 'Avoid using eval() as it can lead to code injection vulnerabilities'
      },
      {
        pattern: /document\.write\s*\(/,
        message: 'Avoid using document.write() as it can lead to XSS vulnerabilities'
      },
      {
        pattern: /innerHTML\s*=/,
        message: 'Consider using textContent instead of innerHTML to prevent XSS attacks'
      },
      {
        pattern: /new\s+Function\s*\(/,
        message: 'Avoid using new Function() as it can lead to code injection vulnerabilities'
      }
    ];

    for (const check of securityPatterns) {
      if (check.pattern.test(code)) {
        issues.push(check.message);
      }
    }

    return issues;
  }

  private async storeValidationIssues(issueId: number | string, file: string, issues: string[]) {
    try {
      const metric: InsertMetric = {
        issuesProcessed: 1,
        fixesAttempted: 1,
        fixesSucceeded: 0,
        avgProcessingTime: 0,
        validationData: {
          issueId,
          file,
          validationIssues: issues,
          timestamp: new Date().toISOString()
        }
      };

      await storage.createMetric(metric);
    } catch (error) {
      console.error('Failed to store validation issues:', error);
    }
  }

  private async generateFixesFromAnalysis(
    suggestedFix: AIServiceResult['fix'],
    relatedFiles: Array<{ path: string; content: string; relevance: number }>
  ) {
    try {
      // Transform the suggested fix into the expected format
      return suggestedFix ? {
        files: suggestedFix.changes.map(change => ({
          path: change.file,
          changes: change.changes.map(c => ({
            lineStart: c.lineStart,
            lineEnd: c.lineEnd,
            oldCode: c.oldCode,
            newCode: c.newCode,
            explanation: c.explanation
          }))
        }))
      } : null;
    } catch (error) {
      console.warn('Error generating fixes:', error);
      return null;
    }
  }
}

export const issueAnalyzer = new IssueAnalyzer();
