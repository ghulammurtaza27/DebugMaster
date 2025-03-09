import { AIService } from '../../server/services/ai-service';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai');

describe('AIService', () => {
  let aiService: AIService;
  const mockGenerateContent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: () => ({
        generateContent: mockGenerateContent
      })
    }));
    aiService = new AIService();
  });

  describe('analyzeBug', () => {
    it('should analyze bug and return structured result', async () => {
      const mockResponse = {
        response: {
          text: () => `
            Root cause: Memory leak in component
            Severity: high
            Impacted components: UserService, AuthController
            
            Suggested fix:
            \`\`\`File: src/services/user.ts
            export class UserService {
              private users: User[] = [];
              
              cleanup() {
                this.users = [];
              }
            }
            \`\`\`
          `
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await aiService.analyzeBug({
        stacktrace: 'Error: Memory leak',
        codeSnippets: ['const users = []'],
        fileContext: ['user.ts content'],
        issueDescription: 'High memory usage'
      });

      expect(result).toEqual({
        rootCause: 'Memory leak in component',
        severity: 'high',
        impactedComponents: ['UserService', 'AuthController'],
        fix: {
          changes: [{
            file: 'src/services/user.ts',
            changes: [{
              lineStart: 1,
              lineEnd: 7,
              oldCode: '',
              newCode: expect.stringContaining('export class UserService'),
              explanation: 'AI-generated fix'
            }]
          }]
        }
      });
    });

    it('should handle AI service errors gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('AI service error'));

      await expect(aiService.analyzeBug({
        stacktrace: 'Error',
        codeSnippets: [],
        fileContext: [],
        issueDescription: 'Test'
      })).rejects.toThrow('Failed to analyze bug with AI');
    });
  });

  describe('validateFix', () => {
    it('should validate code changes and return result', async () => {
      const mockResponse = {
        response: {
          text: () => `
            Issue: Potential memory leak
            Problem: Missing cleanup
            Suggestion: Add cleanup method
            Recommendation: Use WeakMap
          `
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await aiService.validateFix(
        'original code',
        'new code'
      );

      expect(result).toEqual({
        isValid: false,
        issues: ['Potential memory leak', 'Missing cleanup'],
        suggestions: ['Add cleanup method', 'Use WeakMap']
      });
    });

    it('should handle validation errors gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Validation error'));

      await expect(aiService.validateFix(
        'original',
        'new'
      )).rejects.toThrow('Failed to validate fix with AI');
    });
  });

  describe('generateSuggestions', () => {
    it('should generate suggestions for code improvements', async () => {
      const mockResponse = {
        response: {
          text: () => `
            1. Use TypeScript strict mode
            2. Add error handling
            3. Implement logging
          `
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await aiService.generateSuggestions(
        'code',
        [{ type: 'error', message: 'Issue' }]
      );

      expect(result).toEqual([
        'Use TypeScript strict mode',
        'Add error handling',
        'Implement logging'
      ]);
    });

    it('should handle suggestion generation errors gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Suggestion error'));

      const result = await aiService.generateSuggestions(
        'code',
        []
      );

      expect(result).toEqual([]);
    });
  });
}); 