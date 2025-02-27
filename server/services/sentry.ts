import * as Sentry from "@sentry/node";

export class SentryService {
  constructor() {
    Sentry.init({
      dsn: process.env.SENTRY_DSN || "",
      environment: process.env.NODE_ENV || "development"
    });
  }

  async getIssues() {
    try {
      const response = await fetch(
        `https://sentry.io/api/0/projects/${process.env.SENTRY_ORG}/${process.env.SENTRY_PROJECT}/issues/`,
        {
          headers: {
            Authorization: `Bearer ${process.env.SENTRY_TOKEN}`
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
      const response = await fetch(
        `https://sentry.io/api/0/issues/${issueId}/`,
        {
          headers: {
            Authorization: `Bearer ${process.env.SENTRY_TOKEN}`
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
