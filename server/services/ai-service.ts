import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from '@google/generative-ai';
import { storage } from '../storage';
import { RateLimiter } from 'limiter';

export interface AIAnalysisResult {
  rootCause: string;
  severity: 'high' | 'medium' | 'low';
  impactedComponents: string[];
  fix?: {
    changes: Array<{
      file: string;
      changes: Array<{
        lineStart: number;
        lineEnd: number;
        oldCode: string;
        newCode: string;
        explanation: string;
      }>;
    }>;
  };
}

export interface AIValidationResult {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
}

export class AIService {
  private model: GenerativeModel;
  private limiter: RateLimiter;

  constructor() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    this.model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    // Rate limit to 10 requests per minute
    this.limiter = new RateLimiter({
      tokensPerInterval: 10,
      interval: 'minute'
    });
  }

  async analyzeBug(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: string[];
    issueDescription: string;
  }): Promise<AIAnalysisResult> {
    await this.limiter.removeTokens(1);

    try {
      const prompt = `Analyze this bug:
Issue: ${params.issueDescription}
Stack Trace: ${params.stacktrace}
Code Snippets:
${params.codeSnippets.join('\n')}
File Context:
${params.fileContext.join('\n')}

Provide a detailed analysis including:
1. Root cause
2. Severity (high/medium/low)
3. Impacted components
4. Suggested fix with specific code changes`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse the AI response into structured format
      return this.parseAnalysisResponse(text);
    } catch (error) {
      console.error('AI analysis failed:', error);
      throw new Error('Failed to analyze bug with AI');
    }
  }

  async validateFix(originalCode: string, newCode: string): Promise<AIValidationResult> {
    await this.limiter.removeTokens(1);

    try {
      const prompt = `Validate this code change:
Original Code:
${originalCode}

New Code:
${newCode}

Analyze the changes for:
1. Correctness
2. Potential issues
3. Best practices
4. Security concerns
5. Performance implications

Provide a detailed review.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return this.parseValidationResponse(text);
    } catch (error) {
      console.error('AI validation failed:', error);
      throw new Error('Failed to validate fix with AI');
    }
  }

  async generateSuggestions(code: string, issues: any[]): Promise<string[]> {
    await this.limiter.removeTokens(1);

    try {
      const prompt = `Given this code and issues:
Code:
${code}

Issues:
${JSON.stringify(issues, null, 2)}

Provide specific suggestions for:
1. Code improvements
2. Best practices
3. Security enhancements
4. Performance optimizations`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return this.parseSuggestionsResponse(text);
    } catch (error) {
      console.error('AI suggestions generation failed:', error);
      return [];
    }
  }

  private parseAnalysisResponse(text: string): AIAnalysisResult {
    try {
      // Basic parsing of AI response
      const lines = text.split('\n');
      const rootCause = lines.find(l => l.includes('Root cause:'))?.split(':')[1]?.trim() || 'Unknown';
      const severity = (lines.find(l => l.includes('Severity:'))?.split(':')[1]?.trim()?.toLowerCase() || 'medium') as 'high' | 'medium' | 'low';
      const impactedComponents = lines
        .find(l => l.includes('Impacted components:'))
        ?.split(':')[1]
        ?.split(',')
        .map(s => s.trim())
        || [];

      // Parse code changes if present
      const changes = this.parseCodeChanges(text);

      return {
        rootCause,
        severity,
        impactedComponents,
        fix: changes ? { changes } : undefined
      };
    } catch (error) {
      console.error('Failed to parse AI analysis response:', error);
      return {
        rootCause: 'Failed to parse AI response',
        severity: 'medium',
        impactedComponents: []
      };
    }
  }

  private parseValidationResponse(text: string): AIValidationResult {
    try {
      const lines = text.split('\n');
      const issues: string[] = [];
      const suggestions: string[] = [];
      let isValid = true;

      for (const line of lines) {
        if (line.toLowerCase().includes('issue:') || line.toLowerCase().includes('problem:')) {
          issues.push(line.split(':')[1].trim());
          isValid = false;
        }
        if (line.toLowerCase().includes('suggestion:') || line.toLowerCase().includes('recommendation:')) {
          suggestions.push(line.split(':')[1].trim());
        }
      }

      return { isValid, issues, suggestions };
    } catch (error) {
      console.error('Failed to parse AI validation response:', error);
      return {
        isValid: false,
        issues: ['Failed to parse AI response'],
        suggestions: []
      };
    }
  }

  private parseSuggestionsResponse(text: string): string[] {
    try {
      return text
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/^\d+\.\s*/, '').trim());
    } catch (error) {
      console.error('Failed to parse AI suggestions:', error);
      return [];
    }
  }

  private parseCodeChanges(text: string): Array<{
    file: string;
    changes: Array<{
      lineStart: number;
      lineEnd: number;
      oldCode: string;
      newCode: string;
      explanation: string;
    }>;
  }> | null {
    try {
      const codeBlockRegex = /```[\s\S]*?```/g;
      const codeBlocks = text.match(codeBlockRegex);
      
      if (!codeBlocks) return null;

      const changes: Array<{
        file: string;
        changes: Array<{
          lineStart: number;
          lineEnd: number;
          oldCode: string;
          newCode: string;
          explanation: string;
        }>;
      }> = [];

      for (const block of codeBlocks) {
        const lines = block.replace(/```/g, '').trim().split('\n');
        const fileMatch = lines[0].match(/File: (.*)/);
        if (!fileMatch) continue;

        const file = fileMatch[1];
        const changeBlock = {
          file,
          changes: [{
            lineStart: 1,
            lineEnd: lines.length - 1,
            oldCode: '',
            newCode: lines.slice(1).join('\n'),
            explanation: 'AI-generated fix'
          }]
        };

        changes.push(changeBlock);
      }

      return changes.length > 0 ? changes : null;
    } catch (error) {
      console.error('Failed to parse code changes:', error);
      return null;
    }
  }
}

export const aiService = new AIService(); 