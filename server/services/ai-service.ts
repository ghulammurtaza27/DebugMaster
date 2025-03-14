import { GoogleGenerativeAI, GenerativeModel, Content, GenerateContentRequest } from '@google/generative-ai';
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
  diagnostics?: {
    message: string;
    reasons: string[];
    suggestions: string[];
  };
  noFixReason?: string;
  contextQuality?: {
    score: number;
    hasStacktrace: boolean;
    hasCodeSnippets: boolean;
    hasRelevantFiles: boolean;
    suggestions: string[];
  };
}

interface ProjectContext {
  projectStructure: {
    hierarchy: Record<string, string[]>;
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
    testCoverage: Record<string, any>;
  };
  dependencies: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
}

interface FileContextItem {
  path: string;
  content: string;
  relevance: number;
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
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // Rate limit to 10 requests per minute
    this.limiter = new RateLimiter({
      tokensPerInterval: 10,
      interval: 'minute'
    });
  }

  async analyzeBug(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: FileContextItem[];
    issueDescription: string;
    projectContext?: ProjectContext;
  }): Promise<AIAnalysisResult> {
    await this.limiter.removeTokens(1);

    try {
      // Log input parameters for debugging
      console.log('AI analysis input:', {
        issueDescription: params.issueDescription,
        stacktraceLength: params.stacktrace?.length || 0,
        codeSnippetsCount: params.codeSnippets?.length || 0,
        fileContextCount: params.fileContext?.length || 0
      });

      const sortedFiles = params.fileContext
        .sort((a, b) => b.relevance - a.relevance)
        .map(f => `File: ${f.path}\n${f.content}`);

      const projectContext = params.projectContext || {
        projectStructure: {
          hierarchy: {},
          dependencies: {},
          dependents: {},
          testCoverage: {}
        },
        dependencies: {
          dependencies: {},
          devDependencies: {},
          peerDependencies: {}
        }
      };
      
      const prompt = `As a senior developer, analyze this bug with the following context:

ISSUE DESCRIPTION:
${params.issueDescription}

STACK TRACE:
${params.stacktrace}

PROJECT STRUCTURE:
${JSON.stringify(projectContext.projectStructure, null, 2)}

DIRECTLY RELEVANT CODE:
${sortedFiles.slice(0, 3).join('\n\n')}

PACKAGE DEPENDENCIES:
${JSON.stringify(projectContext.dependencies, null, 2)}

TEST COVERAGE:
${JSON.stringify(projectContext.projectStructure.testCoverage, null, 2)}

ADDITIONAL CONTEXT:
${sortedFiles.slice(3).join('\n\n')}

Please provide a detailed analysis including:
1. Root cause analysis with specific line numbers and files
2. Severity assessment (high/medium/low) with justification
3. List of impacted components and their relationships
4. Suggested fix with specific code changes in the following format:
   \`\`\`
   File: [exact file path]
   [complete code snippet with your changes]
   \`\`\`
   For each file you modify, include:
   - All necessary imports
   - Complete function or class definitions
   - Clear comments explaining your changes
5. Potential side effects of the proposed fix
6. Test cases to add or modify

IMPORTANT: For your suggested fix, always include the complete file path and the full code snippet in a code block. If you don't have enough information to propose a specific fix, explain what additional information would be needed.`;

      const result = await this.model.generateContent(prompt);
      const responseText = result.response.text();
      
      // Log AI response for debugging
      console.log('AI response length:', responseText.length);
      console.log('AI response preview:', responseText.substring(0, 500) + '...');
      
      // Check for code blocks
      const codeBlocks = responseText.match(/```[\s\S]*?```/g);
      console.log('Code blocks found:', codeBlocks?.length || 0);
      
      return this.parseAnalysisResponse(responseText);
    } catch (error) {
      console.error('AI analysis failed:', error);
      return this.generateFallbackAnalysis(params);
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
      // Look for code blocks with triple backticks
      const codeBlockRegex = /```[\s\S]*?```/g;
      const codeBlocks = text.match(codeBlockRegex);
      
      // Also look for sections that might contain code changes
      const fixSectionRegex = /(?:Fix|Solution|Code changes|Suggested fix):([\s\S]*?)(?:\n\n|\n##|$)/i;
      const fixSection = text.match(fixSectionRegex);
      
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

      // Process code blocks
      if (codeBlocks) {
        for (const block of codeBlocks) {
          const lines = block.replace(/```/g, '').trim().split('\n');
          
          // Try to find file name in first line or nearby text
          const fileMatch = lines[0].match(/File: (.*)/i) || lines[0].match(/^([^:\n]+\.[a-z]+)$/i);
          let file = '';
          let codeLines = lines;
          
          if (fileMatch) {
            file = fileMatch[1].trim();
            codeLines = lines.slice(1); // Remove the file line
          } else {
            // Try to infer file from context around the code block
            const beforeBlock = text.substring(0, text.indexOf(block));
            const fileInferRegex = /(?:in|file|path|modify):\s*([^\s,\n]+\.[a-z]+)/i;
            const inferMatch = beforeBlock.match(fileInferRegex);
            file = inferMatch ? inferMatch[1].trim() : 'unknown.js';
          }

          // Skip empty code blocks or those that appear to be examples rather than fixes
          if (codeLines.length === 0 || block.includes('example') || block.includes('Example')) {
            continue;
          }

          // Extract explanation from surrounding text
          let explanation = 'AI-generated fix';
          const blockIndex = text.indexOf(block);
          if (blockIndex > 0) {
            const beforeBlock = text.substring(0, blockIndex).trim();
            const lastParagraph = beforeBlock.split('\n\n').pop() || '';
            if (lastParagraph.length > 0 && lastParagraph.length < 500) {
              explanation = lastParagraph;
            }
          }

          const changeBlock = {
            file,
            changes: [{
              lineStart: 1,
              lineEnd: codeLines.length,
              oldCode: '',
              newCode: codeLines.join('\n'),
              explanation
            }]
          };

          changes.push(changeBlock);
        }
      }

      // If no changes found but there's a fix section, try to extract from there
      if (changes.length === 0 && fixSection && fixSection[1]) {
        const fixText = fixSection[1].trim();
        
        // Simple heuristic: if the fix section contains code-like content
        if (fixText.includes('{') || fixText.includes('function') || fixText.includes('const') || 
            fixText.includes('import') || fixText.includes('export')) {
          
          // Try to find a file reference in the fix section
          const fileInferRegex = /(?:in|file|path|modify):\s*([^\s,\n]+\.[a-z]+)/i;
          const inferMatch = fixText.match(fileInferRegex);
          const file = inferMatch ? inferMatch[1].trim() : 'inferred-file.js';
          
          changes.push({
            file,
            changes: [{
              lineStart: 1,
              lineEnd: 1,
              oldCode: '',
              newCode: fixText,
              explanation: 'Inferred from AI analysis'
            }]
          });
        }
      }

      // Look for diff blocks which might contain old and new code
      if (changes.length === 0) {
        const diffRegex = /```diff\n([\s\S]*?)```/g;
        let diffMatch;
        
        while ((diffMatch = diffRegex.exec(text)) !== null) {
          const diffContent = diffMatch[1];
          const fileMatch = diffContent.match(/^(?:---|\+\+\+)\s+([^\s\n]+)/m);
          const file = fileMatch ? fileMatch[1].replace(/^[ab]\//, '') : 'diff-file.js';
          
          // Split into old and new code sections
          const oldLines = diffContent.match(/^-[^\n]+/gm)?.map(line => line.substring(1)) || [];
          const newLines = diffContent.match(/^\+[^\n]+/gm)?.map(line => line.substring(1)) || [];
          
          changes.push({
            file,
            changes: [{
              lineStart: 1,
              lineEnd: newLines.length,
              oldCode: oldLines.join('\n'),
              newCode: newLines.join('\n'),
              explanation: 'Extracted from diff'
            }]
          });
        }
      }

      console.log(`Parsed ${changes.length} code changes from AI response`);
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

  private organizeContext(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: string[];
    issueDescription: string;
  }): {
    directlyRelevant: string[];
    dependencies: string[];
    tests: string[];
  } {
    const organized = {
      directlyRelevant: [] as string[],
      dependencies: [] as string[],
      tests: [] as string[]
    };

    // Extract file paths from stack trace
    const stackTraceFiles = new Set(
      (params.stacktrace.match(/at\s+.*?\((.*?):\d+:\d+\)/g) || [])
        .map(line => line.match(/\((.*?):\d+:\d+\)/))?.[1]
    );

    // Organize file context
    for (const context of params.fileContext) {
      if (context.startsWith('Test File:')) {
        organized.tests.push(context);
      } else if (stackTraceFiles.has(context.split('\n')[0].replace('File: ', ''))) {
        organized.directlyRelevant.push(context);
      } else {
        organized.dependencies.push(context);
      }
    }

    // Add code snippets to directly relevant if they're not already included
    for (const snippet of params.codeSnippets) {
      if (!organized.directlyRelevant.some(ctx => ctx.includes(snippet))) {
        organized.directlyRelevant.push(snippet);
      }
    }

    return organized;
  }

  private generateFallbackAnalysis(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: FileContextItem[];
    issueDescription: string;
  }): AIAnalysisResult {
    console.log('Generating fallback analysis due to AI failure');
    
    // Try to extract some basic information from the available data
    const errorType = this.extractErrorType(params.stacktrace);
    const severity = this.determineSeverity(params.stacktrace);
    const impactedComponents = this.extractImpactedComponents(params.stacktrace, 
      params.fileContext.map(f => f.path));
    
    // Generate a more informative root cause message
    let rootCause = 'Failed to analyze with AI';
    if (errorType) {
      rootCause = `${errorType}: ${params.issueDescription}`;
    } else if (params.stacktrace) {
      rootCause = `Error in ${params.stacktrace.split('\n')[0]}`;
    }
    
    return {
      rootCause,
      severity,
      impactedComponents,
      // Include a basic diagnostic message in the analysis
      diagnostics: {
        message: 'The AI was unable to generate a specific fix for this issue. This could be due to:',
        reasons: [
          'Insufficient context or code samples',
          'Complex issue requiring more detailed analysis',
          'Missing dependencies or configuration information',
          'Error occurring in third-party libraries'
        ],
        suggestions: [
          'Try providing more code context around the error',
          'Include relevant configuration files',
          'Specify the exact steps to reproduce the issue',
          'Consider manual debugging with the provided stack trace'
        ]
      }
    };
  }
  
  private extractErrorType(stacktrace: string): string | null {
    if (!stacktrace) return null;
    
    const errorMatch = stacktrace.match(/([A-Za-z]+Error):/);
    return errorMatch ? errorMatch[1] : null;
  }

  private determineSeverity(stacktrace: string): 'high' | 'medium' | 'low' {
    if (stacktrace.includes('Error: ENOENT') || 
        stacktrace.includes('TypeError') || 
        stacktrace.includes('ReferenceError')) {
      return 'high';
    }
    if (stacktrace.includes('Warning') || 
        stacktrace.includes('Deprecation')) {
      return 'low';
    }
    return 'medium';
  }

  private inferRootCause(params: {
    stacktrace: string;
    issueDescription: string;
  }): string {
    const errorType = (params.stacktrace.match(/([A-Za-z]+Error):/) || [])[1];
    const errorMessage = params.stacktrace.split('\n')[0];
    return `${errorType || 'Unknown error'}: ${errorMessage || params.issueDescription}`;
  }

  private extractImpactedFiles(params: {
    stacktrace: string;
    codeSnippets: string[];
    fileContext: string[];
    issueDescription: string;
  }): string[] {
    const impactedFiles = new Set<string>();
    
    // Extract file paths from stack trace
    const stackTraceFiles = new Set(
      (params.stacktrace.match(/at\s+.*?\((.*?):\d+:\d+\)/g) || [])
        .map(line => line.match(/\((.*?):\d+:\d+\)/))?.[1]
    );

    // Add directly relevant files
    for (const file of params.fileContext) {
      if (stackTraceFiles.has(file.split('\n')[0].replace('File: ', ''))) {
        impactedFiles.add(file);
      }
    }

    // Add code snippets as files
    for (const snippet of params.codeSnippets) {
      impactedFiles.add(snippet);
    }

    return Array.from(impactedFiles);
  }

  async extractRelevantFiles(text: string): Promise<Array<{ path: string }>> {
    await this.limiter.removeTokens(1);

    try {
      const prompt = `Given this text, identify and extract any file paths or references to code files:
${text}

Return ONLY the file paths, one per line.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const paths = response.text()
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(path => ({ path: path.trim() }));

      return paths;
    } catch (error) {
      console.error('Failed to extract file paths:', error);
      return [];
    }
  }
}

export const aiService = new AIService(); 