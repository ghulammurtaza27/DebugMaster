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

  // Initialize services
  async initialize() {
    try {
      console.log('Initializing IntegrationManager...');
      
      // Initialize GitHub service if it hasn't been set externally
      if (!this.github.isInitialized()) {
        console.log('GitHub client not initialized, initializing now...');
        await this.github.initialize();
        
        if (!this.github.isInitialized()) {
          console.error('Failed to initialize GitHub client');
          // Don't throw, we'll continue without GitHub
        } else {
          console.log('GitHub client initialized successfully');
        }
      } else {
        console.log('GitHub client already initialized');
      }
      
      console.log('IntegrationManager initialization complete');
      return true;
    } catch (error) {
      console.error('Failed to initialize IntegrationManager:', error);
      // Don't throw, we'll continue with limited functionality
      return false;
    }
  }

  // Set an already initialized GitHub client
  setGitHubClient(githubClient: GitHubService) {
    this.github = githubClient;
  }

  async processIssue(issue: Issue) {
    try {
      // Log complete issue object for debugging
      console.log('Processing issue with full context:', JSON.stringify({
        id: issue.id,
        title: issue.title,
        description: (issue as any).description || 'No description provided',
        context: issue.context,
        hasStackTrace: !!issue.stacktrace,
      }, null, 2));

      // Use knowledgeGraphService instance instead of knowledgeGraph
      const context = await knowledgeGraphService.buildContext(issue);
      console.log('Knowledge graph context built:', {
        hasFiles: context.files.length > 0,
        fileCount: context.files.length,
        hasProjectStructure: !!context.projectStructure,
        hasDependencies: !!context.dependencies,
        hasDescription: !!context.metadata?.description
      });

      // Ensure code snippets are properly initialized
      let codeSnippets = issue.context?.codeSnippets || [];
      
      // If no code snippets, try to fetch from knowledge graph first, then GitHub repository
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
          // First try to get files from knowledge graph
          try {
            console.log('Attempting to fetch files from knowledge graph...');
            const repoFiles = await knowledgeGraphService.getRepositoryFiles(`${owner}/${repo}`);
            
            if (repoFiles && repoFiles.length > 0) {
              console.log(`Found ${repoFiles.length} files in knowledge graph`);
              
              // Take the top 3 most relevant files
              const topFiles = repoFiles.slice(0, 3);
              for (const file of topFiles) {
                console.log(`Adding file from knowledge graph: ${file.path}`);
                codeSnippets.push(file.content);
              }
            } else {
              console.log('No files found in knowledge graph, checking if GitHub client is available');
              
              // Only try GitHub if the client is properly set and initialized
              const isGitHubAvailable = !!this.github && this.github.isInitialized();
              
              if (isGitHubAvailable) {
                console.log('GitHub client is available, falling back to GitHub API');
                // Fall back to GitHub API if no files in knowledge graph
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
              }
            }
          } catch (error) {
            console.error('Failed to fetch files from knowledge graph:', error);
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
        
        // Log more detailed information about why no fix was proposed
        if (analysis.diagnostics) {
          console.log('AI analysis diagnostics:', {
            message: analysis.diagnostics.message,
            reasons: analysis.diagnostics.reasons,
            suggestions: analysis.diagnostics.suggestions
          });
        }
        
        // Check if we have enough context to make a meaningful analysis
        const contextQuality = this.assessContextQuality({
          stacktrace: issue.stacktrace || '',
          codeSnippets,
          fileContext
        });
        
        console.log('Context quality assessment:', contextQuality);
        
        // Store the analysis result even without a fix
        try {
          await knowledgeGraphService.storeAnalysisResult(issue, analysis);
          console.log('Stored analysis result without fix');
        } catch (storeError) {
          console.error('Failed to store analysis result:', storeError);
        }
        
        return {
          ...analysis,
          noFixReason: 'The AI was unable to generate a specific fix for this issue',
          contextQuality
        };
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
  
  /**
   * Assess the quality of the context provided for analysis
   * This helps determine if we have enough information to make a meaningful analysis
   */
  private assessContextQuality(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: FileContextItem[];
  }): {
    score: number;
    hasStacktrace: boolean;
    hasCodeSnippets: boolean;
    hasRelevantFiles: boolean;
    suggestions: string[];
  } {
    const suggestions: string[] = [];
    let score = 0;
    
    // Check if we have a stack trace
    const hasStacktrace = params.stacktrace.length > 0;
    if (hasStacktrace) {
      score += 0.3;
    } else {
      suggestions.push('Provide a stack trace to help identify the error location');
    }
    
    // Check if we have code snippets
    const hasCodeSnippets = params.codeSnippets.length > 0;
    if (hasCodeSnippets) {
      score += 0.2;
    } else {
      suggestions.push('Include code snippets related to the error');
    }
    
    // Check if we have relevant files
    const hasRelevantFiles = params.fileContext.length > 0;
    if (hasRelevantFiles) {
      // Bonus points for having highly relevant files
      const highlyRelevantFiles = params.fileContext.filter(f => f.relevance > 0.7).length;
      score += 0.2 + (Math.min(highlyRelevantFiles, 3) * 0.1);
    } else {
      suggestions.push('Provide more file context around the error');
    }
    
    // Add general suggestions if score is low
    if (score < 0.5) {
      suggestions.push('Consider providing more detailed error description');
      suggestions.push('Include information about the environment and dependencies');
    }
    
    return {
      score,
      hasStacktrace,
      hasCodeSnippets,
      hasRelevantFiles,
      suggestions
    };
  }
} 