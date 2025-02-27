import { Octokit } from "@octokit/rest";

export class GitHubService {
  private octokit: Octokit;
  
  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
  }

  async createBranch(base: string, newBranch: string) {
    try {
      const { data: ref } = await this.octokit.git.getRef({
        owner: process.env.GITHUB_OWNER || "",
        repo: process.env.GITHUB_REPO || "",
        ref: `heads/${base}`
      });

      await this.octokit.git.createRef({
        owner: process.env.GITHUB_OWNER || "",
        repo: process.env.GITHUB_REPO || "",
        ref: `refs/heads/${newBranch}`,
        sha: ref.object.sha
      });
    } catch (error) {
      console.error("Failed to create branch:", error);
      throw error;
    }
  }

  async createPullRequest(title: string, body: string, head: string, base: string) {
    try {
      const { data: pr } = await this.octokit.pulls.create({
        owner: process.env.GITHUB_OWNER || "",
        repo: process.env.GITHUB_REPO || "",
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
}

export const githubService = new GitHubService();
