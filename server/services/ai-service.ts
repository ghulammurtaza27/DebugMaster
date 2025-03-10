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
  private codebaseContext: Map<string, string[]> = new Map(); // Store context for each repository

  constructor() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    this.model = genAI.getGenerativeModel({ model: 'gemini-flash-1.5' });
    
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
      
      // Return a fallback analysis when the AI service fails
      return {
        rootCause: 'Analysis could not be completed due to AI service unavailability. The issue appears to be related to ' + 
                  (params.stacktrace.includes('Neo4j') ? 'database connectivity' : 
                   params.stacktrace.includes('TypeError') ? 'type errors' : 
                   params.stacktrace.includes('ReferenceError') ? 'undefined references' : 
                   'code execution errors'),
        severity: 'medium',
        impactedComponents: this.extractImpactedComponents(params.stacktrace, params.fileContext),
        fix: undefined
      };
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

  /**
   * Store context about a codebase for future chat interactions
   */
  async buildCodebaseContext(owner: string, repo: string, files: Array<{ path: string; content: string }>) {
    console.log(`Building codebase context for ${owner}/${repo} with ${files.length} files`);
    
    const contextKey = `${owner}/${repo}`;
    const fileContexts: string[] = [];
    
    // Process each file to build context
    for (const file of files) {
      // Skip files that are too large or binary
      if (!file.content || file.content.length > 100000 || this.isBinaryContent(file.content)) {
        continue;
      }
      
      // Create a summary of the file
      const fileSummary = `File: ${file.path}\n${file.content.substring(0, 500)}${file.content.length > 500 ? '...' : ''}`;
      fileContexts.push(fileSummary);
    }
    
    // Store the context
    this.codebaseContext.set(contextKey, fileContexts);
    console.log(`Built context for ${owner}/${repo} with ${fileContexts.length} file summaries`);
    
    return {
      filesProcessed: files.length,
      contextSize: fileContexts.length
    };
  }
  
  /**
   * Chat with the codebase - ask questions about code structure, functionality, etc.
   */
  async chatWithCodebase(owner: string, repo: string, question: string, conversationHistory: Array<{role: 'user' | 'assistant', content: string}> = []) {
    await this.limiter.removeTokens(1);
    
    try {
      const contextKey = `${owner}/${repo}`;
      const codeContext = this.codebaseContext.get(contextKey) || [];
      
      if (codeContext.length === 0) {
        return {
          answer: "I don't have enough context about this codebase yet. Please analyze the repository first.",
          contextSize: 0
        };
      }
      
      console.log(`Chatting with codebase ${owner}/${repo}, context size: ${codeContext.length} files`);
      
      // Prepare the prompt with context and conversation history
      let prompt = `You are an AI assistant that helps developers understand codebases. You have access to the following files from the ${owner}/${repo} repository:\n\n`;
      
      // Add a sample of the context (not all to avoid token limits)
      const contextSample = codeContext.slice(0, 10);
      prompt += contextSample.join('\n\n');
      
      // Add conversation history
      if (conversationHistory.length > 0) {
        prompt += '\n\nConversation history:\n';
        for (const message of conversationHistory) {
          prompt += `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`;
        }
      }
      
      // Add the current question
      prompt += `\nUser: ${question}\n\nAssistant: `;
      
      // Generate the response
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const answer = response.text();
      
      return {
        answer,
        contextSize: codeContext.length
      };
    } catch (error) {
      console.error('AI codebase chat failed:', error);
      throw new Error('Failed to chat with codebase using AI');
    }
  }
  
  /**
   * Check if content appears to be binary (non-text)
   */
  private isBinaryContent(content: string): boolean {
    // Simple heuristic: check for a high percentage of null bytes or non-printable characters
    const nonPrintableCount = (content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    return nonPrintableCount > content.length * 0.1;
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

  // Helper method to extract impacted components from stacktrace
  private extractImpactedComponents(stacktrace: string, fileContext: string[]): string[] {
    const components: Set<string> = new Set();
    
    // Extract file names from stacktrace
    const fileRegex = /\s+at\s+(?:\w+\s+\()?([^:)]+)(?::\d+:\d+)?/g;
    let match;
    while ((match = fileRegex.exec(stacktrace)) !== null) {
      const filePath = match[1];
      if (filePath) {
        const fileName = filePath.split('/').pop() || '';
        if (fileName && !fileName.includes('node_modules')) {
          components.add(fileName.replace(/\.\w+$/, '')); // Remove extension
        }
      }
    }
    
    // If no components found, try to extract from file context
    if (components.size === 0 && fileContext.length > 0) {
      fileContext.forEach(file => {
        if (typeof file === 'string' && file.includes('/')) {
          const fileName = file.split('/').pop() || '';
          if (fileName) {
            components.add(fileName.replace(/\.\w+$/, '')); // Remove extension
          }
        }
      });
    }
    
    return Array.from(components);
  }
}

export const aiService = new AIService(); 