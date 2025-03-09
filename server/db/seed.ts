import { db } from '../db';
import { users, issues, fixes, codeNodes, codeEdges, settings } from '@shared/schema';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';

const scryptAsync = promisify(scrypt);

// Add the hashPassword function directly in the seed file
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function seedDatabase() {
  try {
    // Create test user if it doesn't exist
    const existingUser = await db.select().from(users).where(eq(users.username, 'testuser')).limit(1);
    
    if (existingUser.length === 0) {
      const hashedPassword = await hashPassword('testpassword123');
      await db.insert(users).values({
        username: 'testuser',
        email: 'test@example.com',
        password: hashedPassword,
        role: 'user',
        subscriptionStatus: 'active',
        subscriptionTier: 'free',
        createdAt: new Date(),
      });
    }

    // Update or create GitHub settings
    await db.delete(settings);
    await db.insert(settings).values({
      sentryDsn: process.env.SENTRY_DSN || '',
      sentryToken: process.env.SENTRY_TOKEN || '',
      sentryOrg: process.env.SENTRY_ORG || '',
      sentryProject: process.env.SENTRY_PROJECT || '',
      githubToken: process.env.GITHUB_TOKEN || '',
      githubOwner: process.env.GITHUB_OWNER || '',
      githubRepo: process.env.GITHUB_REPO || '',
      updatedAt: new Date(),
    });

    // Create sample issues
    const sampleIssues = [
      {
        sentryId: 'SENTRY-1234',
        title: "Memory Leak in useEffect Hook",
        stacktrace: `
Error: Memory leak in component
    at LeakyComponent (src/components/LeakyComponent.tsx:15:5)
    at renderWithHooks (react-dom.development.js:14985:18)
    at updateFunctionComponent (react-dom.development.js:17356:20)`,
        status: "analyzing",
        context: {
          browser: "Chrome 120.0.0",
          os: "Windows 10",
          component: "LeakyComponent",
          errorType: "MemoryLeak",
          occurrence: 156,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          affectedUsers: 45
        },
        createdAt: new Date()
      },
      {
        sentryId: 'SENTRY-1235',
        title: "Unhandled Promise Rejection in API Call",
        stacktrace: `
UnhandledPromiseRejectionWarning: Error: Network request failed
    at ApiService.fetchData (src/services/api.ts:25:9)
    at async UserProfile (src/components/UserProfile.tsx:12:23)`,
        status: "new",
        context: {
          browser: "Firefox 122.0",
          os: "MacOS 14.2",
          component: "UserProfile",
          errorType: "PromiseRejection",
          occurrence: 89,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          affectedUsers: 23
        },
        createdAt: new Date()
      },
      {
        sentryId: 'SENTRY-1236',
        title: "React State Update on Unmounted Component",
        stacktrace: `
Warning: Can't perform a React state update on an unmounted component
    at UnstableComponent (src/components/UnstableComponent.tsx:34:12)
    at AsyncComponent (src/components/AsyncComponent.tsx:28:15)`,
        status: "new",
        context: {
          browser: "Safari 17.0",
          os: "iOS 17.1",
          component: "UnstableComponent",
          errorType: "StateUpdateError",
          occurrence: 234,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          affectedUsers: 67
        },
        createdAt: new Date()
      }
    ];

    const createdIssues = await db.insert(issues).values(sampleIssues).returning();

    // Create sample fixes for issues
    const sampleFixes = createdIssues.map(issue => ({
      issueId: issue.id,
      prUrl: `https://github.com/example/repo/pull/${Math.floor(Math.random() * 1000)}`,
      prNumber: Math.floor(Math.random() * 1000),
      status: "pending",
      files: {
        modified: [
          "src/components/LeakyComponent.tsx",
          "src/services/api.ts"
        ],
        additions: 15,
        deletions: 7
      },
      explanation: `Proposed fix for ${issue.title}:
1. Added cleanup function to useEffect
2. Implemented proper error handling
3. Added component mounted check before setState`,
      createdAt: new Date()
    }));

    await db.insert(fixes).values(sampleFixes);

    // Create sample code nodes
    const sampleNodes = [
      {
        path: "src/components/LeakyComponent.tsx",
        type: "component",
        name: "LeakyComponent",
        content: `export function LeakyComponent() {
  useEffect(() => {
    const interval = setInterval(() => {
      // Leaky code
    }, 1000);
  }, []);
}`,
        createdAt: new Date()
      },
      {
        path: "src/services/api.ts",
        type: "service",
        name: "ApiService",
        content: `export class ApiService {
  async fetchData() {
    // Unhandled promise
  }
}`,
        createdAt: new Date()
      }
    ];

    const createdNodes = await db.insert(codeNodes).values(sampleNodes).returning();

    // Create relationships between code nodes
    const sampleEdges = [
      {
        sourceId: createdNodes[0].id,
        targetId: createdNodes[1].id,
        type: "imports",
        metadata: {
          importType: "named",
          importedSymbols: ["ApiService"]
        },
        createdAt: new Date()
      }
    ];

    await db.insert(codeEdges).values(sampleEdges);

    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

// Run the seed function
seedDatabase()
  .then(() => {
    console.log('Seeding completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  }); 