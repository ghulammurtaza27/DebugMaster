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

interface CommitParams {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  content: string;
  path: string;
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

  // Add public getters for owner and repo
  getOwner(): string {
    return this.owner;
  }

  getRepo(): string {
    return this.repo;
  }

  constructor(token?: string) {
    super();
    this.token = token || "";
    this.owner = "";
    this.repo = "";
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
      useMockData: this.useMockData,
      hasWebhookSecret: !!this.webhookSecret
    });
  }

  async initialize() {
    try {
      console.log('Initializing GitHub service...');
      
      // Get settings from database
      const settings = await storage.getSettings();
      if (!settings) {
        throw new Error('GitHub settings not configured');
      }

      // Update service properties with settings from database
      this.token = this.token || settings.githubToken;
      this.owner = settings.githubOwner;
      this.repo = settings.githubRepo;
      
      // Check for required configuration
      const missingConfig = [];
      if (!this.token && !this.useMockData) missingConfig.push('GitHub Token');
      if (!this.owner) missingConfig.push('GitHub Owner');
      if (!this.repo) missingConfig.push('GitHub Repo');
      
      if (missingConfig.length > 0) {
        console.error('Missing required GitHub configuration:', missingConfig);
        throw new Error(`Missing required GitHub configuration: ${missingConfig.join(', ')}`);
      }

      // Skip actual GitHub API calls if using mock data
      if (this.useMockData) {
        console.log("Using mock GitHub data");
        this.authenticatedUser = "mock-user";
        return;
      }

      // Create Octokit instance with retry logic
      let retryCount = 0;
      const maxRetries = 5;
      const maxTimeout = 10000; // 10 seconds
      
      while (retryCount < maxRetries) {
        try {
          console.log(`Attempt ${retryCount + 1}/${maxRetries} to create Octokit instance...`);
          this.octokit = new Octokit({
            auth: this.token,
            request: {
              retries: 3,
              retryAfter: 5,
              timeout: maxTimeout
            },
            timeZone: 'UTC'
          });
          console.log('Octokit instance created successfully');
          break;
        } catch (error: any) {
          retryCount++;
          console.warn(`Failed to create Octokit instance (attempt ${retryCount}/${maxRetries}):`, {
            error: error.message,
            cause: error.cause?.message,
            code: error.cause?.code
          });
          
          if (retryCount === maxRetries) throw error;
          
          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, maxTimeout);
          console.log(`Retrying in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      // Verify authentication with better error handling and retry logic
      retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          console.log(`Attempt ${retryCount + 1}/${maxRetries} to verify GitHub authentication...`);
          const { data: user } = await this.octokit!.users.getAuthenticated();
          this.authenticatedUser = user.login;
          console.log(`Successfully authenticated as ${this.authenticatedUser}`);
          break;
        } catch (authError: any) {
          retryCount++;
          console.warn(`Authentication attempt ${retryCount}/${maxRetries} failed:`, {
            status: authError.status,
            message: authError.message,
            cause: authError.cause?.message,
            code: authError.cause?.code
          });

          // Handle specific error cases
          if (authError.status === 401) {
            throw new Error('Invalid GitHub token. Please check your token and try again.');
          } else if (authError.status === 403) {
            throw new Error('GitHub token lacks required permissions. Please check token scopes.');
          } else if (authError.status === 429) {
            throw new Error('GitHub API rate limit exceeded. Please try again later.');
          }

          // For network errors (ETIMEDOUT, ECONNREFUSED, etc.), retry with backoff
          if (authError.cause?.code && ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(authError.cause.code)) {
            if (retryCount === maxRetries) {
              throw new Error(`Network error connecting to GitHub API: ${authError.cause.code}. Please check your network connection.`);
            }
            const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, maxTimeout);
            console.log(`Network error, retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw authError;
        }
      }

      // Initialize webhooks if secret is configured
      if (this.webhookSecret) {
        console.log('Initializing GitHub webhooks...');
        this.webhooks = new Webhooks({
          secret: this.webhookSecret
        });
        await this.setupWebhooks();
        console.log('GitHub webhooks initialized successfully');
      } else {
        console.warn('GitHub webhook secret not configured, webhooks will be disabled');
      }

      console.log('GitHub service initialized successfully', {
        hasOctokit: !!this.octokit,
        authenticatedUser: this.authenticatedUser,
        hasWebhooks: !!this.webhooks
      });
    } catch (error) {
      console.error('Failed to initialize GitHub service:', error);
      throw error;
    }
  }

  // Check if the GitHub client is initialized
  isInitialized(): boolean {
    // We're initialized if we're using mock data or if we have a valid Octokit instance
    return this.useMockData || (!!this.octokit && !!this.authenticatedUser);
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

  async createBranch(base: string, newBranch: string, initialCommit?: { message: string; content: string; path: string }) {
    try {
      // Initialize with retry logic
      let retryCount = 0;
      const maxRetries = 5;
      const maxTimeout = 10000;

      while (retryCount < maxRetries) {
        try {
          console.log(`Attempt ${retryCount + 1}/${maxRetries} to initialize GitHub service...`);
          await this.initialize();
          break;
        } catch (error: any) {
          retryCount++;
          console.warn(`Failed to initialize GitHub service (attempt ${retryCount}/${maxRetries}):`, {
            error: error.message,
            cause: error.cause?.message,
            code: error.cause?.code
          });

          if (retryCount === maxRetries) {
            throw new Error(`Failed to initialize GitHub service after ${maxRetries} attempts: ${error.message}`);
          }

          // Exponential backoff with jitter for network errors
          if (error.cause?.code && ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.cause.code)) {
            const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, maxTimeout);
            console.log(`Network error, retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw error;
        }
      }

      if (!this.octokit) throw new Error("GitHub client not initialized");

      // First ensure we have a fork
      console.log('Ensuring fork exists...');
      const fork = await this.retryOperation(
        () => this.ensureForked(this.owner, this.repo),
        'ensure fork exists',
        maxRetries
      );
      
      // Get the base branch reference from the original repo
      console.log(`Getting base branch reference for ${base}...`);
      const { data: ref } = await this.retryOperation(
        () => this.octokit!.git.getRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${base}`
        }),
        'get base branch reference',
        maxRetries
      );

      // Create branch in our fork
      console.log(`Creating branch ${newBranch} in fork...`);
      await this.retryOperation(
        () => this.octokit!.git.createRef({
          owner: this.authenticatedUser,
          repo: this.repo,
          ref: `refs/heads/${newBranch}`,
          sha: ref.object.sha
        }),
        'create branch',
        maxRetries
      );

      // If initial commit is provided, create it
      if (initialCommit) {
        console.log('Creating initial commit...');
        await this.retryOperation(
          () => this.createCommit({
            owner: this.authenticatedUser,
            repo: this.repo,
            branch: newBranch,
            message: initialCommit.message,
            content: initialCommit.content,
            path: initialCommit.path
          }),
          'create initial commit',
          maxRetries
        );
      }

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

  // Helper method for retrying operations with exponential backoff
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 5,
    maxTimeout: number = 10000
  ): Promise<T> {
    let retryCount = 0;
    
    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        retryCount++;
        console.warn(`Failed to ${operationName} (attempt ${retryCount}/${maxRetries}):`, {
          error: error.message,
          cause: error.cause?.message,
          code: error.cause?.code
        });

        if (retryCount === maxRetries) {
          throw new Error(`Failed to ${operationName} after ${maxRetries} attempts: ${error.message}`);
        }

        // Retry on network errors with exponential backoff and jitter
        if (error.cause?.code && ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.cause.code)) {
          const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, maxTimeout);
          console.log(`Network error, retrying in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }
  }

  async createCommit(params: CommitParams): Promise<void> {
    if (!this.octokit) throw new Error("GitHub client not initialized");

    try {
      // Get the current commit SHA of the branch
      const { data: ref } = await this.octokit.git.getRef({
        owner: params.owner,
        repo: params.repo,
        ref: `heads/${params.branch}`
      });

      // Get the current tree
      const { data: tree } = await this.octokit.git.getTree({
        owner: params.owner,
        repo: params.repo,
        tree_sha: ref.object.sha,
        recursive: '1'
      });

      // Create a blob with the new content
      const { data: blob } = await this.octokit.git.createBlob({
        owner: params.owner,
        repo: params.repo,
        content: params.content,
        encoding: 'utf-8'
      });

      // Create a new tree with the updated file
      const { data: newTree } = await this.octokit.git.createTree({
        owner: params.owner,
        repo: params.repo,
        base_tree: tree.sha,
        tree: [{
          path: params.path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha
        }]
      });

      // Create a new commit
      const { data: commit } = await this.octokit.git.createCommit({
        owner: params.owner,
        repo: params.repo,
        message: params.message,
        tree: newTree.sha,
        parents: [ref.object.sha]
      });

      // Update the branch reference
      await this.octokit.git.updateRef({
        owner: params.owner,
        repo: params.repo,
        ref: `heads/${params.branch}`,
        sha: commit.sha
      });

      console.log(`Successfully created commit on branch ${params.branch}`);
    } catch (error) {
      console.error("Failed to create commit:", error);
      throw error;
    }
  }

  async createPullRequest(title: string, body: string, head: string, base: string) {
    try {
      await this.initialize();
      if (!this.octokit) throw new Error("GitHub client not initialized");

      // Verify that there are commits between the branches
      const { data: comparison } = await this.octokit.repos.compareCommits({
        owner: this.owner,
        repo: this.repo,
        base,
        head: `${this.authenticatedUser}:${head}`
      });

      if (comparison.commits.length === 0) {
        throw new Error("No commits found between branches. Please ensure changes are committed before creating a pull request.");
      }

      const { data: pr } = await this.octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head: `${this.authenticatedUser}:${head}`,
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
      // Make sure GitHub client is initialized
      console.log('Initializing GitHub client for processing issue from URL...');
      await this.initialize();
      
      // Double-check initialization was successful
      if (!this.isInitialized()) {
        console.error('GitHub client initialization failed - cannot continue');
        throw new Error("GitHub client initialization failed");
      } else {
        console.log('GitHub client successfully initialized');
      }
      
      const { owner, repo, issueNumber } = this.parseIssueUrl(issueUrl);
      console.log(`Parsed issue URL: owner=${owner}, repo=${repo}, issueNumber=${issueNumber}`);
      
      // Fetch issue details
      console.log(`Fetching issue details for ${owner}/${repo}#${issueNumber}...`);
      const { data: githubIssue } = await this.octokit!.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });
      console.log(`Successfully fetched issue: ${githubIssue.title}`);

      // Extract description from issue body
      const description = githubIssue.body || '';
      console.log(`Issue description length: ${description.length} characters`);

      // Create issue in our system
      console.log('Creating issue in our system...');
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
      
      // Add description to the issue object
      (issue as any).description = description;
      console.log(`Created issue in our system with ID: ${issue.id}`);

      // Analyze the issue but don't create a PR
      console.log('Analyzing issue...');
      await issueAnalyzer.analyzeIssue(issue, { skipBranchCreation: true });
      console.log('Issue analysis complete');

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
    // Log the params for debugging
    console.log('getFileContents params:', {
      owner: params.owner,
      repo: params.repo,
      path: typeof params.path === 'object' ? JSON.stringify(params.path) : params.path,
      pathType: typeof params.path
    });
    
    // Handle case where path is an object instead of a string (happens with default context files)
    let path: string | any = params.path;
    if (typeof path !== 'string') {
      // If path is an object with a path property, extract it
      if (path && typeof path === 'object' && 'path' in path) {
        const pathObj = path as { path: string };
        if (typeof pathObj.path === 'string') {
          console.log(`Path is an object with path property: ${pathObj.path}`);
          path = pathObj.path;
        } else {
          console.error('Invalid path property type:', typeof pathObj.path);
          throw new Error(`Invalid path property type: ${typeof pathObj.path}`);
        }
      } else {
        console.error('Invalid path parameter:', path);
        throw new Error(`Invalid path parameter: ${JSON.stringify(path)}`);
      }
    }
    
    // Handle special case files generated by the knowledge graph service
    if (path === 'issue-context.txt' || path === 'repository-info.txt') {
      console.log(`Returning content for special file: ${path}`);
      return `This is a generated file for ${path}. It contains context information for the issue.`;
    }
    
    // If using mock data, return mock file contents
    if (this.useMockData) {
      return this.getMockFileContents(path);
    }
    
    try {
      // Ensure we're initialized
      if (!this.octokit) {
        console.log('GitHub client not initialized, initializing now...');
        await this.initialize();
        
        // Double-check initialization was successful
        if (!this.octokit) {
          throw new Error("GitHub client initialization failed");
        }
      }
      
      // Check if we're rate limited
      if (this.rateLimitExceeded && Date.now() < this.rateLimitReset) {
        const resetDate = new Date(this.rateLimitReset);
        throw new Error(`GitHub API rate limit exceeded. Reset at ${resetDate.toLocaleTimeString()}`);
      }
      
      const maxRetries = 3;
      let retryCount = 0;
      let lastError: any;

      while (retryCount < maxRetries) {
        try {
          const response = await this.octokit.repos.getContent({
            owner: params.owner,
            repo: params.repo,
            path: path,
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
          console.warn(`Unexpected response type for ${path}:`, response.data);
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
      console.error(`Failed to get contents for ${path}:`, error);
      
      // Return empty array for directories that can't be accessed
      if (typeof path === 'string' && path.includes('/') && !path.includes('.')) {
        console.warn(`Assuming ${path} is a directory and returning empty array`);
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