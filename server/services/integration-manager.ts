import { AIService } from './ai-service';
import { knowledgeGraph } from './knowledge-graph';
import { GitHubService } from './github';
import type { Issue } from '@shared/schema';
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

export class IntegrationManager {
  private ai: AIService;
  private github: GitHubService;

  constructor() {
    this.ai = new AIService();
    this.github = new GitHubService();
  }

  async processIssue(issue: Issue) {
    try {
      // Use knowledgeGraph instance instead of creating new one
      const context = await knowledgeGraph.buildContext(issue);

      // Analyze with AI
      const analysis = await this.ai.analyzeBug({
        stacktrace: issue.stacktrace,
        codeSnippets: issue.context.codeSnippets,
        fileContext: context.files,
        issueDescription: issue.title
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
      await knowledgeGraph.storeFix(issue, analysis.fix);

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