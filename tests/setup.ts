import { jest } from '@jest/globals';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.test' });

// Mock external services
jest.mock('@google/generative-ai');
jest.mock('@octokit/rest');
jest.mock('neo4j-driver');

// Setup global test timeouts
jest.setTimeout(30000);

// Mock console methods to keep test output clean
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
}); 