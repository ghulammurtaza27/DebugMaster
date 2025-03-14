import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combines multiple class names and merges Tailwind classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a date string to a readable format
 */
export function formatDate(dateString: string): string {
  if (!dateString) return "Unknown date";
  
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date);
}

/**
 * Truncates a string to a specified length
 */
export function truncateString(str: string, maxLength: number = 100): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}

/**
 * Extracts the repository owner and name from a GitHub URL
 */
export function extractRepoInfo(repoUrl: string): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  
  // Handle formats like "owner/repo" or "https://github.com/owner/repo"
  const githubUrlPattern = /github\.com\/([^\/]+)\/([^\/]+)/;
  const simplePattern = /^([^\/]+)\/([^\/]+)$/;
  
  let match = repoUrl.match(githubUrlPattern);
  if (!match) {
    match = repoUrl.match(simplePattern);
  }
  
  if (match && match.length >= 3) {
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, ""), // Remove .git suffix if present
    };
  }
  
  return null;
}

/**
 * Creates a GitHub URL from owner and repo
 */
export function createGitHubUrl(owner: string, repo: string, type: "issues" | "pulls" | "repo" = "repo", number?: number): string {
  const baseUrl = `https://github.com/${owner}/${repo}`;
  
  switch (type) {
    case "issues":
      return number ? `${baseUrl}/issues/${number}` : `${baseUrl}/issues`;
    case "pulls":
      return number ? `${baseUrl}/pull/${number}` : `${baseUrl}/pulls`;
    case "repo":
    default:
      return baseUrl;
  }
}
