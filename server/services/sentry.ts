import * as Sentry from "@sentry/node";
import { storage } from "../storage";

export class SentryService {
  private dsn: string;
  private token: string;
  private org: string;
  private project: string;

  constructor(dsn?: string, token?: string) {
    this.dsn = dsn || "";
    this.token = token || "";
    this.org = "";
    this.project = "";
  }

  async initialize() {
    const settings = await storage.getSettings();
    if (!settings) {
      throw new Error("Sentry settings not configured");
    }

    this.dsn = settings.sentryDsn;
    this.token = settings.sentryToken;
    this.org = settings.sentryOrg;
    this.project = settings.sentryProject;

    Sentry.init({
      dsn: this.dsn,
      environment: process.env.NODE_ENV || "development"
    });
  }

  async testConnection() {
    try {
      const response = await fetch(
        `https://sentry.io/api/0/projects/${this.org}/${this.project}/`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`
          }
        }
      );
      if (!response.ok) {
        throw new Error("Failed to connect to Sentry");
      }
      return await response.json();
    } catch (error) {
      console.error("Failed to test Sentry connection:", error);
      throw new Error("Could not connect to Sentry. Please check your credentials.");
    }
  }

  async getIssues() {
    try {
      await this.initialize();
      const response = await fetch(
        `https://sentry.io/api/0/projects/${this.org}/${this.project}/issues/`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`
          }
        }
      );
      return await response.json();
    } catch (error) {
      console.error("Failed to fetch Sentry issues:", error);
      throw error;
    }
  }

  async getIssueDetails(issueId: string) {
    try {
      await this.initialize();
      const response = await fetch(
        `https://sentry.io/api/0/issues/${issueId}/`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`
          }
        }
      );
      return await response.json();
    } catch (error) {
      console.error("Failed to fetch Sentry issue details:", error);
      throw error;
    }
  }
}

export const sentryService = new SentryService();