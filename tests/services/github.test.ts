import { GitHubService } from '../../server/services/github';
import { Octokit } from '@octokit/rest';
import { storage } from '../../server/storage';

jest.mock('@octokit/rest');
jest.mock('../../server/storage');

describe('GitHubService', () => {
  let githubService: GitHubService;
  const mockOctokit = {
    users: {
      getAuthenticated: jest.fn()
    },
    repos: {
      get: jest.fn(),
      getContent: jest.fn(),
      merge: jest.fn(),
      updateBranchProtection: jest.fn()
    },
    pulls: {
      get: jest.fn(),
      listReviews: jest.fn(),
      listFiles: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      requestReviewers: jest.fn(),
      merge: jest.fn()
    },
    git: {
      getRef: jest.fn(),
      createRef: jest.fn()
    },
    webhooks: {
      on: jest.fn()
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (Octokit as jest.Mock).mockImplementation(() => mockOctokit);
    (storage.getSettings as jest.Mock).mockResolvedValue({
      githubToken: 'test-token',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo'
    });
    githubService = new GitHubService();
  });

  describe('initialize', () => {
    it('should initialize GitHub client with settings', async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'test-user' }
      });

      await githubService.initialize();

      expect(Octokit).toHaveBeenCalledWith({
        auth: 'test-token'
      });
      expect(mockOctokit.users.getAuthenticated).toHaveBeenCalled();
    });

    it('should throw error if token is not configured', async () => {
      (storage.getSettings as jest.Mock).mockResolvedValue(null);

      await expect(githubService.initialize()).rejects.toThrow('GitHub token not configured');
    });
  });

  describe('getPRStatus', () => {
    beforeEach(async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'test-user' }
      });
      await githubService.initialize();
    });

    it('should return PR status with reviews and conflicts', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 1,
          state: 'open',
          mergeable: true,
          merged: false
        }
      });

      mockOctokit.pulls.listReviews.mockResolvedValue({
        data: [{
          user: { login: 'reviewer' },
          state: 'approved',
          comments: ['LGTM']
        }]
      });

      mockOctokit.pulls.listFiles.mockResolvedValue({
        data: [{
          filename: 'test.ts',
          status: 'modified',
          conflicting: true
        }]
      });

      const status = await githubService.getPRStatus(1);

      expect(status).toEqual({
        number: 1,
        state: 'open',
        mergeable: true,
        conflicts: ['test.ts'],
        reviews: [{
          user: 'reviewer',
          state: 'approved',
          comments: ['LGTM']
        }]
      });
    });
  });

  describe('resolveMergeConflicts', () => {
    beforeEach(async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'test-user' }
      });
      await githubService.initialize();
    });

    it('should resolve conflicts by merging base into head', async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          base: { ref: 'main' },
          head: { ref: 'feature' }
        }
      }).mockResolvedValueOnce({
        data: {
          number: 1,
          state: 'open',
          mergeable: true,
          merged: false
        }
      });

      mockOctokit.pulls.listFiles.mockResolvedValueOnce({
        data: [{
          filename: 'test.ts',
          status: 'modified',
          conflicting: true
        }]
      }).mockResolvedValueOnce({
        data: []
      });

      mockOctokit.repos.merge.mockResolvedValue({
        data: { merged: true }
      });

      const resolved = await githubService.resolveMergeConflicts(1);

      expect(resolved).toBe(true);
      expect(mockOctokit.repos.merge).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        base: 'feature',
        head: 'main'
      });
    });
  });

  describe('mergePR', () => {
    beforeEach(async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'test-user' }
      });
      await githubService.initialize();
    });

    it('should merge PR when there are no conflicts', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 1,
          state: 'open',
          mergeable: true,
          merged: false
        }
      });

      mockOctokit.pulls.listFiles.mockResolvedValue({
        data: []
      });

      mockOctokit.pulls.merge.mockResolvedValue({
        data: { merged: true }
      });

      const merged = await githubService.mergePR(1);

      expect(merged).toBe(true);
      expect(mockOctokit.pulls.merge).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 1,
        merge_method: 'squash'
      });
    });

    it('should attempt to resolve conflicts before merging', async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          number: 1,
          state: 'open',
          mergeable: false,
          merged: false,
          base: { ref: 'main' },
          head: { ref: 'feature' }
        }
      });

      mockOctokit.pulls.listFiles.mockResolvedValue({
        data: [{
          filename: 'test.ts',
          status: 'modified',
          conflicting: true
        }]
      });

      mockOctokit.repos.merge.mockResolvedValue({
        data: { merged: true }
      });

      const merged = await githubService.mergePR(1);

      expect(merged).toBe(false);
      expect(mockOctokit.repos.merge).toHaveBeenCalled();
    });
  });
}); 