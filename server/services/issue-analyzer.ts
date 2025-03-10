import { Issue } from '@shared/schema';
import { storage } from '../storage';
import { githubService } from './github';
import { knowledgeGraphService } from './knowledge-graph';
import { AIService } from './ai-service';
import { validationService } from './validation-service';
import * as ts from 'typescript';
import { ESLint } from 'eslint';
import { InsertMetric } from '@shared/schema';

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
      
      // Extract code snippets and stack trace
      const codeSnippets = issue.context.codeSnippets || [];
      const stackTrace = issue.stacktrace || '';

      // Get related files and their content
      // Handle case where graphContext.files might be empty or undefined
      const filesToAnalyze = graphContext.files || [];
      const relatedFiles = await this.getRelatedFilesContent(filesToAnalyze);

      // If we don't have any related files but have code snippets, use those
      if (relatedFiles.length === 0 && codeSnippets.length > 0) {
        console.log('No related files found from knowledge graph. Using code snippets for analysis.');
      }

      // Perform AI analysis
      const aiAnalysis = await this.ai.analyzeBug({
        stacktrace: stackTrace,
        codeSnippets,
        fileContext: relatedFiles,
        issueDescription: issue.title
      });

      // Transform AI analysis fix format to match expected format
      const suggestedFix = aiAnalysis.fix ? {
        files: aiAnalysis.fix.changes.map(change => ({
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
            const validation = await this.validateProposedChange({
              file: file.path,
              newCode: file.changes[0].newCode
            });
            
            if (!validation.isValid) {
              console.warn(`Invalid fix for ${file.path}:`, validation.issues);
              // Store validation issues for reference
              await this.storeValidationIssues(issue.id, file.path, validation.issues);
            }
          } catch (error) {
            console.warn(`Validation failed for ${file.path}:`, error);
            // Continue with other files even if validation fails for one
          }
        }
      }

      // Create branch if needed and if we have fixes
      if (!options.skipBranchCreation && suggestedFix && suggestedFix.files.length > 0) {
        try {
          const branchName = `fix/${issue.id}`;
          await githubService.createBranch('main', branchName);
        } catch (error) {
          console.warn('Failed to create branch:', error);
          // Continue even if branch creation fails
        }
      }

      // Map the relationships to match the expected type
      // Handle case where graphContext.relationships might be empty or undefined
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
          rootCause: aiAnalysis.rootCause,
          severity: aiAnalysis.severity,
          impactedComponents: aiAnalysis.impactedComponents,
          suggestedFix
        },
        relatedFiles: graphContext.files || [],
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

  private async getRelatedFilesContent(filePaths: string[]): Promise<string[]> {
    const contents: string[] = [];
    for (const path of filePaths) {
      try {
        // Get settings first to access owner and repo
        const settings = await storage.getSettings();
        if (!settings) {
          throw new Error('GitHub settings not configured');
        }

        const content = await githubService.getFileContents({
          owner: settings.githubOwner,
          repo: settings.githubRepo,
          path
        });
        contents.push(`File: ${path}\n${content}`);
      } catch (error) {
        console.warn(`Failed to get content for ${path}:`, error);
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

      const originalContent = await githubService.getFileContents({
        owner: settings.githubOwner,
        repo: settings.githubRepo,
        path: change.file
      });
      
      // Validate the change using AI
      const validation = await this.ai.validateFix(
        typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
        change.newCode
      );

      // Additional static analysis
      const staticAnalysisIssues = await this.performStaticAnalysis(change.newCode);
      
      return {
        isValid: validation.isValid && staticAnalysisIssues.length === 0,
        issues: [...validation.issues, ...staticAnalysisIssues]
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
