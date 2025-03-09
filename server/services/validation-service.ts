import { ESLint } from 'eslint';
import * as ts from 'typescript';
import { AIService } from './ai-service';
import { githubService } from './github';
import path from 'path';

interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  suggestions: string[];
  securityScore: number;
}

interface ValidationIssue {
  type: 'syntax' | 'types' | 'security' | 'logic' | 'style';
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  file: string;
}

interface SecurityPattern {
  pattern: RegExp;
  message: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
}

export class ValidationService {
  private eslint: ESLint;
  private ai: AIService;
  private securityPatterns: SecurityPattern[] = [];

  constructor() {
    this.eslint = new ESLint({
      cwd: process.cwd(),
      baseConfig: {
        rules: {
          'no-eval': 'error',
          'no-implied-eval': 'error'
        }
      },
      fix: false
    });
    
    this.ai = new AIService();
    this.initializeSecurityPatterns();
  }

  private initializeSecurityPatterns(): void {
    this.securityPatterns = [
      {
        pattern: /eval\s*\(/,
        message: 'Avoid using eval() as it can lead to code injection vulnerabilities',
        severity: 'error',
        category: 'code-injection'
      },
      {
        pattern: /document\.write\s*\(/,
        message: 'Avoid using document.write() as it can lead to XSS vulnerabilities',
        severity: 'error',
        category: 'xss'
      },
      {
        pattern: /innerHTML\s*=/,
        message: 'Consider using textContent instead of innerHTML to prevent XSS attacks',
        severity: 'warning',
        category: 'xss'
      },
      {
        pattern: /new\s+Function\s*\(/,
        message: 'Avoid using new Function() as it can lead to code injection vulnerabilities',
        severity: 'error',
        category: 'code-injection'
      },
      {
        pattern: /localStorage\./,
        message: 'Be cautious with localStorage usage and ensure sensitive data is not stored',
        severity: 'warning',
        category: 'data-security'
      },
      {
        pattern: /sessionStorage\./,
        message: 'Be cautious with sessionStorage usage and ensure sensitive data is not stored',
        severity: 'warning',
        category: 'data-security'
      },
      {
        pattern: /console\.(log|debug|info|warn|error)\(/,
        message: 'Remove console statements in production code',
        severity: 'info',
        category: 'best-practice'
      },
      {
        pattern: /process\.env\./,
        message: 'Ensure environment variables are properly sanitized',
        severity: 'warning',
        category: 'configuration'
      }
    ];
  }

  async validateFix(file: string, originalCode: string, newCode: string): Promise<ValidationResult> {
    try {
      const issues: ValidationIssue[] = [];
      
      // 1. Syntax Validation
      const syntaxIssues = await this.validateSyntax(newCode);
      issues.push(...syntaxIssues);

      // 2. Type Checking
      const typeIssues = await this.validateTypes(newCode, file);
      issues.push(...typeIssues);

      // 3. ESLint Validation
      const lintIssues = await this.validateLinting(newCode, file);
      issues.push(...lintIssues);

      // 4. Security Analysis
      const securityIssues = await this.validateSecurity(newCode, file);
      issues.push(...securityIssues);

      // 5. AI-based Logic Validation
      const aiValidation = await this.ai.validateFix(originalCode, newCode);
      const logicIssues = this.convertAiIssuesToValidationIssues(aiValidation.issues, file);
      issues.push(...logicIssues);

      // Calculate security score
      const securityScore = this.calculateSecurityScore(issues);

      // Generate suggestions for improvements
      const suggestions = await this.generateSuggestions(issues, newCode);

      return {
        isValid: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        suggestions,
        securityScore
      };
    } catch (error) {
      console.error('Validation failed:', error);
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async validateSyntax(code: string): Promise<ValidationIssue[]> {
    try {
      ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );
      return [];
    } catch (error) {
      return [{
        type: 'syntax',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Syntax error',
        file: 'temp.ts'
      }];
    }
  }

  private async validateTypes(code: string, filename: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    try {
      const options: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        skipLibCheck: true
      };

      // Create a virtual file system
      const host = ts.createCompilerHost(options);
      const virtualFileName = path.basename(filename);
      
      // Add the code to the virtual file system
      host.getSourceFile = (fileName: string) => {
        if (fileName === virtualFileName) {
          return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest);
        }
        return undefined;
      };

      const program = ts.createProgram([virtualFileName], options, host);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      for (const diagnostic of diagnostics) {
        if (diagnostic.file && diagnostic.start !== undefined) {
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          issues.push({
            type: 'types',
            severity: 'error',
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            line: line + 1,
            column: character + 1,
            file: filename
          });
        }
      }
    } catch (error) {
      issues.push({
        type: 'types',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Type checking failed',
        file: filename
      });
    }

    return issues;
  }

  private async validateLinting(code: string, filename: string): Promise<ValidationIssue[]> {
    try {
      const results = await this.eslint.lintText(code, { filePath: filename });
      return results[0].messages.map(msg => ({
        type: 'style',
        severity: msg.severity === 2 ? 'error' : 'warning',
        message: msg.message,
        line: msg.line,
        column: msg.column,
        file: filename
      }));
    } catch (error) {
      return [{
        type: 'style',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Linting failed',
        file: filename
      }];
    }
  }

  private async validateSecurity(code: string, filename: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Check for security patterns
      for (const pattern of this.securityPatterns) {
        if (pattern.pattern.test(code)) {
          issues.push({
            type: 'security',
            severity: pattern.severity,
            message: `${pattern.message} (${pattern.category})`,
            file: filename
          });
        }
      }

      // Check for potential secrets/tokens in code
      const secretPatterns = [
        /(['"])[0-9a-f]{32,}\1/i,  // Generic tokens
        /(['"])[0-9a-f]{40}\1/i,    // Git tokens
        /(['"])pk_live_[0-9a-zA-Z]{24}\1/,  // Stripe keys
        /(['"])sk_live_[0-9a-zA-Z]{24}\1/,  // Stripe secret keys
        /(['"])[a-z0-9]{64,}\1/i,   // Long hex strings that might be secrets
      ];

      for (const pattern of secretPatterns) {
        if (pattern.test(code)) {
          issues.push({
            type: 'security',
            severity: 'error',
            message: 'Potential secret or API key found in code',
            file: filename
          });
        }
      }

      // Additional security checks
      if (code.includes('debugger')) {
        issues.push({
          type: 'security',
          severity: 'warning',
          message: 'Debugger statement found in code',
          file: filename
        });
      }

    } catch (error) {
      issues.push({
        type: 'security',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Security validation failed',
        file: filename
      });
    }

    return issues;
  }

  private convertAiIssuesToValidationIssues(aiIssues: string[], filename: string): ValidationIssue[] {
    return aiIssues.map(issue => ({
      type: 'logic',
      severity: 'warning',
      message: issue,
      file: filename
    }));
  }

  private calculateSecurityScore(issues: ValidationIssue[]): number {
    const securityIssues = issues.filter(i => i.type === 'security');
    const baseScore = 100;
    const deductions = {
      error: 25,
      warning: 10,
      info: 5
    };

    const score = securityIssues.reduce((score, issue) => 
      score - deductions[issue.severity], baseScore);

    return Math.max(0, Math.min(100, score)); // Ensure score is between 0 and 100
  }

  private async generateSuggestions(issues: ValidationIssue[], code: string): Promise<string[]> {
    const suggestions: string[] = [];

    // Group issues by type
    const issuesByType = issues.reduce((acc, issue) => {
      if (!acc[issue.type]) {
        acc[issue.type] = [];
      }
      acc[issue.type].push(issue);
      return acc;
    }, {} as Record<string, ValidationIssue[]>);

    // Generate suggestions based on issue types
    if (issuesByType.security?.length > 0) {
      suggestions.push('Consider implementing security best practices for identified vulnerabilities');
    }

    if (issuesByType.types?.length > 0) {
      suggestions.push('Review type definitions and ensure proper type safety');
    }

    if (issuesByType.style?.length > 0) {
      suggestions.push('Follow consistent code style and formatting guidelines');
    }

    // Add AI-generated suggestions if available
    try {
      // Only call AI suggestions if the method exists
      if ('generateSuggestions' in this.ai) {
        const aiSuggestions = await (this.ai as any).generateSuggestions(code, issues);
        if (Array.isArray(aiSuggestions)) {
          suggestions.push(...aiSuggestions);
        }
      }
    } catch (error) {
      console.warn('Failed to generate AI suggestions:', error);
    }

    // Remove duplicates without using Set
    return suggestions.filter((item, index) => suggestions.indexOf(item) === index);
  }
}

export const validationService = new ValidationService(); 