import { Issue } from '@shared/schema';
import { storage } from '../storage';
import { githubService } from './github';
import { knowledgeGraphService } from './knowledge-graph';
import { AIService } from './ai-service';
import { validationService } from './validation-service';
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

export class IssueAnalyzer {
  private ai: AIService;
  private eslint: ESLint;

  constructor() {
    this.ai = new AIService();
    this.eslint = new ESLint({
      baseConfig: {},
      fix: false
    });
  }

  async analyzeIssue(issue: Issue, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    try {
      // Update issue status
      await storage.updateIssueStatus(
        typeof issue.id === 'string' ? parseInt(issue.id) : issue.id,
        'analyzing'
      );

      // Build knowledge graph context
      const graphContext = await knowledgeGraphService.buildContext(issue);
      console.log('Knowledge graph context built with', graphContext.files.length, 'files');
      
      // Extract code snippets and stack trace
      const codeSnippets = issue.context?.codeSnippets || [];
      const stackTrace = issue.stacktrace || '';

      // Get related files and their content
      const filesToAnalyze = graphContext.files || [];
      console.log('Files to analyze:', filesToAnalyze.map(file => typeof file === 'object' ? file.path : file));
      
      const relatedFiles = await this.getRelatedFilesContent(filesToAnalyze);
      console.log('Retrieved', relatedFiles.length, 'related files');

      // If we don't have any related files but have code snippets, use those
      if (relatedFiles.length === 0 && codeSnippets.length > 0) {
        console.log('No related files found from knowledge graph. Using code snippets for analysis.');
      }

      // Extract description from issue or from graphContext metadata
      const description = (issue as any).description || graphContext.metadata?.description || issue.title;
      console.log('Using description for analysis:', description.substring(0, 100) + (description.length > 100 ? '...' : ''));

      // Perform AI analysis
      const analysis = await this.ai.analyzeBug({
        stacktrace: stackTrace,
        codeSnippets,
        fileContext: filesToAnalyze,
        issueDescription: description,
        projectContext: {
          projectStructure: graphContext.projectStructure,
          dependencies: graphContext.metadata?.dependencies || {}
        }
      });

      // Transform AI analysis fix format to match expected format
      const suggestedFix = analysis.fix ? {
        files: analysis.fix.changes.map(change => ({
          path: change.file,
          changes: change.changes.map(c => ({
            lineStart: c.lineStart,
            lineEnd: c.lineEnd,
            oldCode: c.oldCode,
            newCode: c.newCode,
            explanation: c.explanation
          }))
        }))
      } : undefined;

      // Validate proposed fixes if we have them
      if (suggestedFix && suggestedFix.files.length > 0) {
        for (const file of suggestedFix.files) {
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
                path: file.path
              });
              originalContent = typeof content === 'string' ? content : JSON.stringify(content);
            } catch (error: any) {
              if (error.status === 404) {
                // File doesn't exist, treat as new file
                console.log(`File ${file.path} doesn't exist, treating as new file`);
                continue;
              }
              throw error;
            }
            
            // If file exists, validate the change using AI
            if (originalContent) {
              const validation = await this.ai.validateFix(
                originalContent,
                file.changes[0].newCode
              );

              if (!validation.isValid) {
                console.warn(`Invalid fix for ${file.path}:`, validation.issues);
                // Store validation issues for reference
                await this.storeValidationIssues(issue.id, file.path, validation.issues);
              }
            }
          } catch (error) {
            console.warn(`Validation failed for ${file.path}:`, error);
            // Continue with other files even if validation fails for one
          }
        }
      }

      // Map the relationships to match the expected type
      const dependencies = (graphContext.relationships || []).map((rel: { source: string; relationship: string; target: string }) => ({
        source: rel.source,
        target: rel.target,
        type: rel.relationship
      }));

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
        relatedFiles: filesToAnalyze.map(file => typeof file === 'object' ? file.path : file),
        dependencies
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

  private async getRelatedFilesContent(files: FileContextItem[]): Promise<string[]> {
    const contents: string[] = [];
    console.log('Getting related files content for', files.length, 'files');
    
    for (const file of files) {
      try {
        console.log('Processing file:', typeof file === 'object' ? JSON.stringify({path: file.path}) : file);
        
        // If the file already has content, use it
        if (file.content) {
          console.log(`Using existing content for ${file.path}`);
          contents.push(`File: ${file.path}\n${file.content}`);
          continue;
        }
        
        // Otherwise, fetch content from GitHub
        // Get settings first to access owner and repo
        const settings = await storage.getSettings();
        if (!settings) {
          throw new Error('GitHub settings not configured');
        }

        // Ensure file.path is a string before passing it to getFileContents
        if (typeof file.path !== 'string') {
          console.warn(`Invalid file path: ${JSON.stringify(file.path)}`);
          continue;
        }

        console.log(`Fetching content for ${file.path} from GitHub`);
        const content = await githubService.getFileContents({
          owner: settings.githubOwner,
          repo: settings.githubRepo,
          path: file.path
        });
        
        if (typeof content === 'string') {
          contents.push(`File: ${file.path}\n${content}`);
        } else {
          console.warn(`Received non-string content for ${file.path}, skipping`);
        }
      } catch (error) {
        console.warn(`Failed to get content for ${file.path}:`, error);
      }
    }
    return contents;
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
}

export const issueAnalyzer = new IssueAnalyzer();
