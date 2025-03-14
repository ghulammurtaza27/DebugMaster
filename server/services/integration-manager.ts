import { AIService } from './ai-service';
import { GitHubService } from './github';
import { Issue } from '@shared/schema';
import { knowledgeGraphService } from './knowledge-graph';
import type { AIAnalysisResult } from './ai-service';

interface CodeChange {
  lineStart: number;
  lineEnd: number;
  oldCode: string;
  newCode: string;
  explanation: string;
}

interface FileChange {
  file: string;
  changes: CodeChange[];
}

interface FileContextItem {
  path: string;
  content: string;
  relevance: number;
}

export class IntegrationManager {
  private ai: AIService;
  private github: GitHubService;

  constructor() {
    this.ai = new AIService();
    this.github = new GitHubService();
  }

  async processIssue(issue: Issue) {
    try {
      // Use knowledgeGraphService instance instead of knowledgeGraph
      const context = await knowledgeGraphService.buildContext(issue);

      // Ensure code snippets are properly initialized
      const codeSnippets = issue.context?.codeSnippets || [];
      if (context.files.length > 0 && codeSnippets.length === 0) {
        // If no code snippets provided but we have files, use the most relevant file content
        const relevantFiles = context.files
          .sort((a, b) => (typeof a === 'object' && typeof b === 'object' ? b.relevance - a.relevance : 0))
          .slice(0, 3);
        
        for (const file of relevantFiles) {
          const content = typeof file === 'object' ? file.content : file;
          codeSnippets.push(content);
        }
      }

      // Convert context to the format expected by AI service
      const fileContext: FileContextItem[] = context.files.map((file: { path: string; content: string; relevance: number } | string) => ({
        path: typeof file === 'string' ? file.split('\n')[0].replace('File: ', '') : file.path,
        content: typeof file === 'string' ? file.split('\n').slice(1).join('\n') : file.content,
        relevance: typeof file === 'string' ? 0.5 : file.relevance
      }));

      // Analyze with AI
      const analysis = await this.ai.analyzeBug({
        stacktrace: issue.stacktrace || '',
        codeSnippets,
        fileContext,
        issueDescription: issue.title,
        projectContext: {
          projectStructure: context.projectStructure || {
            hierarchy: {},
            dependencies: {},
            dependents: {},
            testCoverage: {}
          },
          dependencies: context.dependencies || {
            dependencies: {},
            devDependencies: {},
            peerDependencies: {}
          }
        }
      });

      if (!analysis.fix) {
        console.warn('No fix proposed by AI analysis');
        return analysis;
      }

      // Validate proposed fix
      for (const change of analysis.fix.changes) {
        const oldCode = change.changes[0]?.oldCode || '';
        const newCode = change.changes[0]?.newCode || '';
        
        const validation = await this.ai.validateFix(
          oldCode,
          newCode
        );

        if (!validation.isValid) {
          console.warn('Fix validation issues:', validation.issues);
          // Handle invalid fix
          continue;
        }
      }

      // Create PR with fixes
      const prDescription = this.generatePRDescription(analysis.fix);
      const branchName = `fix/issue-${issue.id}`;
      
      await this.github.createBranch('main', branchName);
      await this.github.createPullRequest(
        `Fix: ${issue.title}`,
        prDescription,
        branchName,
        'main'
      );

      // Store successful fix in knowledge graph
      await knowledgeGraphService.storeFix(issue, analysis.fix);

      return analysis;
    } catch (error) {
      console.error('Error processing issue:', error);
      throw error;
    }
  }

  private generatePRDescription(fix: NonNullable<AIAnalysisResult['fix']>): string {
    const changes = fix.changes.map((change: FileChange) => {
      const fileChanges = change.changes.map((c: CodeChange) => 
        `${c.explanation}\n\`\`\`diff\n-${c.oldCode}\n+${c.newCode}\n\`\`\``
      ).join('\n\n');
      
      return `### ${change.file}\n${fileChanges}`;
    }).join('\n\n');

    return `## Automated Fix\n\n${changes}\n\nThis pull request was automatically generated to fix reported issues.`;
  }
} 