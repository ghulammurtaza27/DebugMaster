import { Issue, Fix } from "@shared/schema";
import { storage } from "../storage";
import { githubService } from "./github";

export class IssueAnalyzer {
  async analyzeIssue(issue: Issue): Promise<Fix> {
    try {
      // Update issue status to analyzing
      await storage.updateIssueStatus(issue.id, "analyzing");

      // Extract relevant information from context
      const { stacktrace, context } = issue;
      const files = this.identifyAffectedFiles(stacktrace, context);
      
      // Generate fix explanation
      const explanation = this.generateExplanation(stacktrace, context);

      // Create GitHub branch and PR
      const branchName = `fix/issue-${issue.id}`;
      await githubService.createBranch("main", branchName);

      const pr = await githubService.createPullRequest(
        `Fix: ${issue.title}`,
        explanation,
        branchName,
        "main"
      );

      // Create fix record
      const fix = await storage.createFix({
        issueId: issue.id,
        prUrl: pr.html_url,
        prNumber: pr.number,
        status: "created",
        files,
        explanation
      });

      // Update issue status to fixed
      await storage.updateIssueStatus(issue.id, "fixed");

      return fix;
    } catch (error) {
      console.error("Error analyzing issue:", error);
      await storage.updateIssueStatus(issue.id, "failed");
      throw error;
    }
  }

  private identifyAffectedFiles(stacktrace: string, context: any): any[] {
    // Extract file paths from stacktrace
    const fileMatches = stacktrace.match(/(?:at\s+)?(?:\w+\s+)?\(?([^:]+):\d+:\d+\)?/g) || [];
    const files = fileMatches.map(match => {
      const [_, path] = match.match(/([^:]+):\d+:\d+/) || [];
      return {
        path,
        changes: this.suggestChanges(path, context)
      };
    });

    return files;
  }

  private suggestChanges(filePath: string, context: any): string {
    // This is where you would implement your AI-powered code analysis
    // For now, we'll return a placeholder
    return `// TODO: Implement AI-powered fix generation
// Context: ${JSON.stringify(context)}`;
  }

  private generateExplanation(stacktrace: string, context: any): string {
    return `## Issue Analysis

### Stack Trace
\`\`\`
${stacktrace}
\`\`\`

### Context
${JSON.stringify(context, null, 2)}

### Proposed Fix
This fix addresses the issue by:
1. Identifying affected files
2. Analyzing error patterns
3. Applying necessary code changes

Please review the changes carefully before merging.`;
  }
}

export const issueAnalyzer = new IssueAnalyzer();
