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
      // Log complete issue object for debugging
      console.log('Processing issue with full context:', JSON.stringify({
        id: issue.id,
        title: issue.title,
        context: issue.context,
        hasStackTrace: !!issue.stacktrace,
      }, null, 2));

      // Use knowledgeGraphService instance instead of knowledgeGraph
      const context = await knowledgeGraphService.buildContext(issue);
      console.log('Knowledge graph context built:', {
        hasFiles: context.files.length > 0,
        fileCount: context.files.length,
        hasProjectStructure: !!context.projectStructure,
        hasDependencies: !!context.dependencies
      });

      // Ensure code snippets are properly initialized
      let codeSnippets = issue.context?.codeSnippets || [];
      
      // If no code snippets, try to fetch from GitHub repository
      if (codeSnippets.length === 0) {
        // Get repository info from either context.repository or githubMetadata
        const repoInfo = {
          fromRepository: issue.context?.repository?.split('/') || [],
          fromMetadata: {
            owner: issue.context?.githubMetadata?.owner,
            repo: issue.context?.githubMetadata?.repo
          }
        };
        console.log('Repository info:', repoInfo);

        const owner = repoInfo.fromMetadata.owner || repoInfo.fromRepository[0];
        const repo = repoInfo.fromMetadata.repo || repoInfo.fromRepository[1];

        if (owner && repo) {
          console.log('Attempting to fetch repository content for:', { owner, repo });
          try {
            // First, try to get src or source directory
            let repoContent = await this.github.getFileContents({
              owner,
              repo,
              path: 'src'
            }).catch(() => 
              this.github.getFileContents({
                owner,
                repo,
                path: 'source'
              })
            ).catch(() => 
              this.github.getFileContents({
                owner,
                repo,
                path: ''
              })
            );

            console.log('Repository content retrieved:', {
              isArray: Array.isArray(repoContent),
              contentLength: Array.isArray(repoContent) ? repoContent.length : 'N/A',
              type: typeof repoContent
            });

            if (Array.isArray(repoContent)) {
              const mainFiles = repoContent
                .filter((f: { path: string; type: string }) => {
                  const isSourceFile = f.type === 'file' && (
                    f.path.endsWith('.ts') || 
                    f.path.endsWith('.tsx') || 
                    f.path.endsWith('.js') || 
                    f.path.endsWith('.jsx')
                  );
                  console.log('Filtering file:', { path: f.path, type: f.type, isSourceFile });
                  return isSourceFile;
                })
                .slice(0, 3);

              console.log('Found source files:', mainFiles);

              // Fetch content for each file
              for (const file of mainFiles) {
                console.log('Attempting to fetch content for:', file.path);
                try {
                  const content = await this.github.getFileContents({
                    owner,
                    repo,
                    path: file.path
                  });
                  if (typeof content === 'string') {
                    console.log(`Successfully retrieved content for ${file.path} (${content.length} chars)`);
                    codeSnippets.push(content);
                  } else {
                    console.warn(`Unexpected content type for ${file.path}:`, typeof content);
                  }
                } catch (fileError) {
                  console.error(`Failed to fetch content for ${file.path}:`, fileError);
                }
              }
            } else {
              console.warn('Repository content is not an array:', typeof repoContent);
            }
          } catch (error) {
            console.error('Failed to fetch repository files:', {
              error: error instanceof Error ? error.message : 'Unknown error',
              owner,
              repo,
              stack: error instanceof Error ? error.stack : undefined
            });
          }
        } else {
          console.warn('Missing repository information:', {
            contextRepository: issue.context?.repository,
            githubMetadata: issue.context?.githubMetadata,
            parsedInfo: { owner, repo }
          });
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