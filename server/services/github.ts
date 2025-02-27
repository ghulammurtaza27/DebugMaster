import { Octokit } from "@octokit/rest";
import { storage } from "../storage";

export class GitHubService {
  private octokit: Octokit | null;
  private token: string;
  private owner: string;
  private repo: string;

  constructor(token?: string) {
    this.token = token || "";
    this.owner = "";
    this.repo = "";
    this.octokit = null;
  }

  async initialize() {
    const settings = await storage.getSettings();
    if (!settings) {
      throw new Error("GitHub settings not configured");
    }

    this.token = settings.githubToken;
    this.owner = settings.githubOwner;
    this.repo = settings.githubRepo;

    this.octokit = new Octokit({
      auth: this.token
    });
  }

  async testConnection(owner: string, repo: string) {
    try {
      const octokit = new Octokit({ auth: this.token });
      await octokit.repos.get({
        owner,
        repo,
      });
    } catch (error) {
      throw new Error("Could not connect to GitHub. Please check your credentials.");
    }
  }

  async createBranch(base: string, newBranch: string) {
    try {
      await this.initialize();
      if (!this.octokit) throw new Error("GitHub client not initialized");

      const { data: ref } = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${base}`
      });

      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
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
}

export const githubService = new GitHubService();