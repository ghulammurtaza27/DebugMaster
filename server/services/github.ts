import { Octokit } from "@octokit/rest";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { storage } from "../storage";
import { Issue } from "@shared/schema";
import { issueAnalyzer } from "./issue-analyzer";
import { IntegrationManager } from "./integration-manager";
import { EventEmitter } from "events";

interface FileContentsParams {
  owner: string;
  repo: string;
  path: string;
}

interface PRStatus {
  number: number;
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean;
  conflicts: string[];
  reviews: Array<{
    user: string;
    state: 'approved' | 'changes_requested' | 'commented';
    comments: string[];
  }>;
}

export class GitHubService extends EventEmitter {
  private octokit: Octokit | null;
  private webhooks: Webhooks | null;
  private token: string;
  private owner: string;
  private repo: string;
  private authenticatedUser!: string;
  private webhookSecret: string;
  private useMockData: boolean;
  private rateLimitExceeded: boolean = false;
  private rateLimitReset: number = 0;

  constructor(token?: string) {
    super();
    this.token = token || process.env.GITHUB_TOKEN || "";
    this.owner = process.env.GITHUB_OWNER || "";
    this.repo = process.env.GITHUB_REPO || "";
    this.octokit = null;
    this.webhooks = null;
    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "";
    this.useMockData = process.env.USE_MOCK_GITHUB === "true";

    // Log configuration (without exposing the actual token)
    console.log('GitHub Service Configuration:', {
      hasToken: !!this.token,
      tokenLength: this.token.length,
      owner: this.owner,
      repo: this.repo,
      useMockData: this.useMockData
    });
  }

  async initialize() {
    try {
      console.log('Initializing GitHub service...');
      
      if (!this.token && !this.useMockData) {
        throw new Error('GitHub token not configured. Please check your environment variables or settings.');
      }

      if (!this.owner || !this.repo) {
        throw new Error('GitHub owner and repo must be configured.');
      }

      // Skip actual GitHub API calls if using mock data
      if (this.useMockData) {
        console.log("Using mock GitHub data");
        this.authenticatedUser = "mock-user";
        return;
      }

      // Create Octokit instance
      console.log('Creating Octokit instance...');
      this.octokit = new Octokit({
        auth: this.token
      });

      // Verify authentication
      try {
        console.log('Verifying GitHub authentication...');
        const { data: user } = await this.octokit.users.getAuthenticated();
        this.authenticatedUser = user.login;
        console.log(`Successfully authenticated as ${this.authenticatedUser}`);
      } catch (authError: any) {
        console.error('GitHub authentication failed:', authError.message);
        if (authError.status === 401) {
          throw new Error('Invalid GitHub token. Please check your token and try again.');
        }
        throw authError;
      }

      // Initialize webhooks if secret is configured
      if (this.webhookSecret) {
        this.webhooks = new Webhooks({
          secret: this.webhookSecret
        });
      }

      console.log('GitHub service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize GitHub service:', error);
      throw error;
    }
  }

  private async setupWebhooks() {
    if (!this.webhookSecret || !this.octokit) {
      console.warn("GitHub webhook secret not configured or client not initialized, skipping webhook setup");
      return;
    }

    this.webhooks = new Webhooks({
      secret: this.webhookSecret
    });

    // Setup webhook handlers
    this.webhooks.on("pull_request.closed", async ({ payload }) => {
      if (payload.pull_request.merged) {
        this.emit("pr_merged", {
          number: payload.pull_request.number,
          title: payload.pull_request.title,
          mergedBy: payload.pull_request.merged_by?.login
        });
      }
    });

    this.webhooks.on("pull_request_review", async ({ payload }) => {
      this.emit("pr_reviewed", {
        number: payload.pull_request.number,
        reviewer: payload.review.user?.login || 'unknown',
        state: payload.review.state
      });
    });

    this.webhooks.on("pull_request.synchronize", async ({ payload }) => {
      await this.getPRStatus(payload.pull_request.number);
    });

    return createNodeMiddleware(this.webhooks, {
      path: "/api/github/webhooks"
    });
  }

  async getPRStatus(prNumber: number): Promise<PRStatus> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      const [prData, reviews] = await Promise.all([
        this.octokit.pulls.get({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber
        }),
        this.octokit.pulls.listReviews({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber
        })
      ]);

      const conflicts = await this.getConflictingFiles(prNumber);

      return {
        number: prNumber,
        state: prData.data.merged ? 'merged' : prData.data.state as 'open' | 'closed',
        mergeable: prData.data.mergeable || false,
        conflicts,
        reviews: reviews.data.map(review => ({
          user: review.user?.login || 'unknown',
          state: review.state as 'approved' | 'changes_requested' | 'commented',
          comments: [] // Initialize with empty array since comments are loaded separately
        }))
      };
    } catch (error) {
      console.error(`Failed to get PR status for #${prNumber}:`, error);
      throw error;
    }
  }

  private async getConflictingFiles(prNumber: number): Promise<string[]> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      const { data: files } = await this.octokit.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber
      });

      return files
        .filter(file => file.status === 'modified' && file.patch?.includes('<<<<<<< HEAD'))
        .map(file => file.filename);
    } catch (error) {
      console.error(`Failed to get conflicting files for PR #${prNumber}:`, error);
      return [];
    }
  }

  async resolveMergeConflicts(prNumber: number): Promise<boolean> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      const status = await this.getPRStatus(prNumber);
      if (!status.conflicts.length) return true;

      // Get base and head branches
      const { data: pr } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber
      });

      const baseBranch = pr.base.ref;
      const headBranch = pr.head.ref;

      // Try to merge base into head
      await this.octokit.repos.merge({
        owner: this.owner,
        repo: this.repo,
        base: headBranch,
        head: baseBranch
      });

      // Check if conflicts were resolved
      const newStatus = await this.getPRStatus(prNumber);
      return newStatus.conflicts.length === 0;
    } catch (error) {
      console.error(`Failed to resolve conflicts for PR #${prNumber}:`, error);
      return false;
    }
  }

  async updatePRDescription(prNumber: number, description: string): Promise<void> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      await this.octokit.pulls.update({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        body: description
      });
    } catch (error) {
      console.error(`Failed to update PR #${prNumber} description:`, error);
      throw error;
    }
  }

  async requestReview(prNumber: number, reviewers: string[]): Promise<void> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      await this.octokit.pulls.requestReviewers({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        reviewers
      });
    } catch (error) {
      console.error(`Failed to request review for PR #${prNumber}:`, error);
      throw error;
    }
  }

  async mergePR(prNumber: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      const status = await this.getPRStatus(prNumber);
      
      if (!status.mergeable) {
        const resolved = await this.resolveMergeConflicts(prNumber);
        if (!resolved) return false;
      }

      await this.octokit.pulls.merge({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        merge_method: method
      });

      return true;
    } catch (error) {
      console.error(`Failed to merge PR #${prNumber}:`, error);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing GitHub connection...');

      if (!this.octokit) {
        throw new Error('GitHub client not initialized. Please initialize the service first.');
      }

      // Test repository access
      console.log(`Testing access to repository ${this.owner}/${this.repo}...`);
      try {
        await this.octokit.repos.get({
          owner: this.owner,
          repo: this.repo,
        });
      } catch (repoError: any) {
        if (repoError.status === 404) {
          throw new Error(`Repository ${this.owner}/${this.repo} not found. Please check the repository name and owner.`);
        } else if (repoError.status === 403) {
          throw new Error(`Access denied to repository ${this.owner}/${this.repo}. Please check your token permissions.`);
        }
        throw repoError;
      }

      // Test rate limit status
      const { data: rateLimit } = await this.octokit.rateLimit.get();
      const remaining = rateLimit.resources.core.remaining;
      const resetTime = new Date(rateLimit.resources.core.reset * 1000);

      console.log('GitHub API Rate Limit Status:', {
        remaining,
        resetTime: resetTime.toLocaleString(),
      });

      if (remaining < 100) {
        console.warn(`Warning: Only ${remaining} GitHub API calls remaining. Rate limit resets at ${resetTime.toLocaleString()}`);
      }

      console.log('GitHub connection test successful');
      return true;
    } catch (error) {
      console.error('GitHub connection test failed:', error);
      throw error;
    }
  }

  async ensureForked(owner: string, repo: string) {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      // Check if fork already exists
      const { data: repos } = await this.octokit.repos.listForAuthenticatedUser({
        per_page: 100
      });

      const existingFork = repos.find(r => r.name === repo && r.fork);
      
      if (existingFork) {
        return existingFork;
      }

      // Create fork if it doesn't exist
      const { data: fork } = await this.octokit.repos.createFork({
        owner,
        repo
      });

      // Wait for fork to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));

      return fork;
    } catch (error) {
      console.error("Failed to ensure fork exists:", error);
      throw error;
    }
  }

  async createBranch(base: string, newBranch: string) {
    try {
      await this.initialize();
      if (!this.octokit) throw new Error("GitHub client not initialized");

      // First ensure we have a fork
      const fork = await this.ensureForked(this.owner, this.repo);
      
      // Get the base branch reference from the original repo
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${base}`
      });

      // Create branch in our fork
      await this.octokit.git.createRef({
        owner: this.authenticatedUser,
        repo: this.repo,
        ref: `refs/heads/${newBranch}`,
        sha: ref.object.sha
      });

      return {
        owner: this.authenticatedUser,
        repo: this.repo,
        branch: newBranch
      };
    } catch (error) {
      console.error("Failed to create branch:", error);
      throw error;
    }
  }

  async createPullRequest(title: string, body: string, head: string, base: string) {
    try {
      await this.initialize();
      if (!this.octokit) throw new Error("GitHub client not initialized");

      const { data: pr } = await this.octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head,
        base
      });
      return pr;
    } catch (error) {
      console.error("Failed to create pull request:", error);
      throw error;
    }
  }

  async processIssueFromUrl(issueUrl: string): Promise<Issue> {
    try {
      await this.initialize();
      if (!this.octokit) throw new Error("GitHub client not initialized");

      const { owner, repo, issueNumber } = this.parseIssueUrl(issueUrl);
      
      // Fetch issue details
      const { data: githubIssue } = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });

      // Create issue in our system
      const issue = await storage.createIssue({
        sentryId: `GH-${owner}-${repo}-${issueNumber}`,
        title: githubIssue.title,
        stacktrace: this.extractStackTrace(githubIssue.body || ''),
        status: "new",
        context: {
          repository: `${owner}/${repo}`,
          issueUrl: githubIssue.html_url,
          labels: githubIssue.labels.map((l: any) => l.name),
          codeSnippets: this.extractCodeSnippets(githubIssue.body || ''),
          githubMetadata: {
            owner,
            repo,
            issueNumber,
            created: githubIssue.created_at,
            updated: githubIssue.updated_at
          }
        }
      });

      // Skip branch creation during initial analysis
      await issueAnalyzer.analyzeIssue(issue, { skipBranchCreation: true });

      const integrationManager = new IntegrationManager();
      await integrationManager.processIssue(issue);

      return issue;
    } catch (error) {
      console.error("Failed to process GitHub issue:", error);
      throw error;
    }
  }

  private parseIssueUrl(url: string) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) throw new Error("Invalid GitHub issue URL");
    
    const [_, owner, repo, issueNumber] = match;
    return { owner, repo, issueNumber: parseInt(issueNumber) };
  }

  private extractStackTrace(body: string): string {
    const stackTraceRegex = /```[\s\S]*?Error:[\s\S]*?```|Error:[\s\S]*?(at .*(\n|$))+/;
    const match = body.match(stackTraceRegex);
    return match ? match[0].replace(/```/g, '') : 'No stack trace provided';
  }

  private extractCodeSnippets(body: string): string[] {
    const snippets: string[] = [];
    
    // Match GitHub-style code blocks with or without language specification
    // Example: ```javascript or ``` or ```ts
    const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(body)) !== null) {
      const [_, language, code] = match;
      const formattedCode = code.trim();
      
      if (formattedCode) {
        // Include language information if available
        const snippet = language 
          ? `Language: ${language}\n${formattedCode}`
          : formattedCode;
        snippets.push(snippet);
      }
    }

    // Also match inline code blocks
    const inlineCodeRegex = /`([^`]+)`/g;
    while ((match = inlineCodeRegex.exec(body)) !== null) {
      const [_, code] = match;
      const trimmedCode = code.trim();
      if (trimmedCode && trimmedCode.includes('\n')) {
        // Only include inline blocks that contain newlines (likely code)
        snippets.push(trimmedCode);
      }
    }

    return snippets;
  }

  async getFileContents(params: FileContentsParams): Promise<string | Array<{ name: string; path: string; type: string }>> {
    // If using mock data, return mock file contents
    if (this.useMockData) {
      return this.getMockFileContents(params.path);
    }
    
    if (!this.octokit) throw new Error("GitHub client not initialized");
    
    // Check if we're rate limited
    if (this.rateLimitExceeded && Date.now() < this.rateLimitReset) {
      const resetDate = new Date(this.rateLimitReset);
      throw new Error(`GitHub API rate limit exceeded. Reset at ${resetDate.toLocaleTimeString()}`);
    }
    
    try {
      const maxRetries = 3;
      let retryCount = 0;
      let lastError: any;

      while (retryCount < maxRetries) {
        try {
          const response = await this.octokit.repos.getContent({
            owner: params.owner,
            repo: params.repo,
            path: params.path,
          });

          if (Array.isArray(response.data)) {
            // Handle directory contents
            return response.data.map(item => ({
              name: item.name,
              path: item.path,
              type: item.type
            }));
          }

          if ('content' in response.data) {
            // Handle file contents
            return Buffer.from(response.data.content, 'base64').toString();
          }
          
          // If we get here, it's neither a file nor a directory
          console.warn(`Unexpected response type for ${params.path}:`, response.data);
          return [];
        } catch (error: any) {
          lastError = error;

          // Check if we hit rate limits
          if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
            const resetTimestamp = parseInt(error.response.headers['x-ratelimit-reset']) * 1000;
            this.rateLimitExceeded = true;
            this.rateLimitReset = resetTimestamp;
            const resetDate = new Date(resetTimestamp);
            throw new Error(`GitHub API rate limit exceeded. Reset at ${resetDate.toLocaleTimeString()}`);
          }

          // If it's a network error or 5xx, retry
          if (!error.status || error.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
            retryCount++;
            continue;
          }

          // For other errors, throw immediately
          throw error;
        }
      }

      throw lastError || new Error('Failed to get contents after retries');
    } catch (error) {
      console.error(`Failed to get contents for ${params.path}:`, error);
      
      // Return empty array for directories that can't be accessed
      if (params.path.includes('/') && !params.path.includes('.')) {
        console.warn(`Assuming ${params.path} is a directory and returning empty array`);
        return [];
      }
      
      throw error;
    }
  }

  // Mock implementation for development
  private getMockFileContents(path: string): string | Array<{ name: string; path: string; type: string }> {
    if (path === '') {
      // Root directory
      return [
        { name: 'src', path: 'src', type: 'dir' },
        { name: 'package.json', path: 'package.json', type: 'file' },
        { name: 'README.md', path: 'README.md', type: 'file' }
      ];
    } else if (path === 'src') {
      // src directory
      return [
        { name: 'index.js', path: 'src/index.js', type: 'file' },
        { name: 'components', path: 'src/components', type: 'dir' }
      ];
    } else if (path === 'src/components') {
      // components directory
      return [
        { name: 'App.js', path: 'src/components/App.js', type: 'file' },
        { name: 'Button.js', path: 'src/components/Button.js', type: 'file' }
      ];
    } else if (path === 'src/index.js') {
      return `import React from 'react';
import ReactDOM from 'react-dom';
import App from './components/App';

ReactDOM.render(<App />, document.getElementById('root'));`;
    } else if (path === 'src/components/App.js') {
      return `import React from 'react';
import Button from './Button';

function App() {
  return (
    <div>
      <h1>Hello World</h1>
      <Button>Click Me</Button>
    </div>
  );
}

export default App;`;
    } else if (path === 'src/components/Button.js') {
      return `import React from 'react';

function Button({ children }) {
  return <button>{children}</button>;
}

export default Button;`;
    } else if (path === 'package.json') {
      return `{
  "name": "mock-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^17.0.2",
    "react-dom": "^17.0.2"
  }
}`;
    } else if (path === 'README.md') {
      return `# Mock App\n\nThis is a mock app for development.`;
    }
    
    throw new Error(`Mock file not found: ${path}`);
  }

  async createBranchProtectionRule(branch: string): Promise<void> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      await this.octokit.repos.updateBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch,
        required_status_checks: {
          strict: true,
          contexts: ['continuous-integration/jenkins']
        },
        enforce_admins: true,
        required_pull_request_reviews: {
          dismissal_restrictions: {
            users: [],
            teams: []
          },
          dismiss_stale_reviews: true,
          require_code_owner_reviews: true,
          required_approving_review_count: 1
        },
        restrictions: null
      });
    } catch (error) {
      console.error(`Failed to create branch protection rule for ${branch}:`, error);
      throw error;
    }
  }
}

export const githubService = new GitHubService();