import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, createGitHubUrl, truncateString } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CodeSnippet } from "@/components/code-snippet";
import { FileChanges } from "@/components/file-changes";
import { IssueMetadata } from "@/components/issue-metadata";
import { IssueAnalysis } from "@/components/issue-analysis";
import { ErrorMessage } from "@/components/error-message";
import { FeatureRequest } from "@/components/feature-request";
import { CodeImplementation } from "@/components/code-implementation";
import {
  AlertCircle,
  GitPullRequest,
  Terminal,
  Code,
  FileText,
  Info,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  FileCode,
} from "lucide-react";
import type { Issue, Fix } from "@shared/schema";

// Add an extended interface for the issue context to include files
interface ExtendedIssueContext {
  repository?: string;
  issueUrl?: string;
  labels?: string[];
  codeSnippets?: string[];
  files?: Array<{
    path: string;
    content: string;
    relevance?: number;
  }>;
  githubMetadata?: {
    owner: string;
    repo: string;
    issueNumber: number;
    created: string;
    updated: string;
  };
}

// Extend the Issue type to include our extended context
interface ExtendedIssue extends Omit<Issue, 'context'> {
  context?: ExtendedIssueContext;
  logs?: string | Record<string, any>;
  error?: string;
  description?: string;
}

// Add an interface for analysis results
interface AnalysisResult {
  rootCause?: string;
  severity?: 'high' | 'medium' | 'low';
  impactedComponents?: string[];
  diagnostics?: {
    message?: string;
    reasons?: string[];
    suggestions?: string[];
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

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: issue, isLoading: isLoadingIssue } = useQuery<ExtendedIssue>({
    queryKey: [`/api/issues/${id}`],
  });

  const { data: fixes, isLoading: isLoadingFixes } = useQuery<Fix[]>({
    queryKey: [`/api/fixes/${id}`],
  });

  const { data: analysis, isLoading: isLoadingAnalysis } = useQuery<AnalysisResult>({
    queryKey: [`/api/issues/${id}/analysis`],
    enabled: !!issue,
  });

  const { mutate: analyzeMutation, isPending: isAnalyzing } = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/issues/${id}/analyze`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/fixes/${id}`] });
      toast({
        title: "Analysis started",
        description: "The issue is being analyzed and fixes will be generated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoadingIssue || isLoadingFixes) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="space-y-6">
          <Skeleton className="h-10 w-3/4" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Skeleton className="h-24 col-span-1" />
            <Skeleton className="h-24 col-span-3" />
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <ErrorMessage 
          title="Issue Not Found"
          message="The requested issue could not be found. It may have been deleted or you may not have permission to view it."
          actions={
            <Button 
              variant="outline" 
              onClick={() => window.history.back()}
              className="mt-2"
            >
              Go Back
            </Button>
          }
        />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "analyzing":
        return <Badge variant="secondary" className="flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> Analyzing</Badge>;
      case "fixed":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Fixed</Badge>;
      case "failed":
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{issue.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              {getStatusBadge(issue.status)}
              {issue.context?.repository && (
                <a 
                  href={`https://github.com/${issue.context.repository}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  <GitPullRequest className="h-4 w-4" />
                  {issue.context.repository}
                </a>
              )}
              {issue.context?.githubMetadata?.created && (
                <span className="text-sm text-muted-foreground">
                  Created: {formatDate(issue.context.githubMetadata.created)}
                </span>
              )}
            </div>
          </div>
          <Button
            onClick={() => analyzeMutation()}
            disabled={isAnalyzing || issue.status === "analyzing"}
            className="md:self-start flex items-center gap-2"
          >
            {isAnalyzing || issue.status === "analyzing" ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Terminal className="h-4 w-4" />
                Analyze Issue
              </>
            )}
          </Button>
        </div>

        {/* Description Section */}
        {issue.description && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-500" />
                Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose dark:prose-invert max-w-none">
                {issue.description}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid grid-cols-4 w-full max-w-md">
            <TabsTrigger value="details" className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </TabsTrigger>
            <TabsTrigger value="context" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              <span className="hidden sm:inline">Context</span>
            </TabsTrigger>
            <TabsTrigger value="files" className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              <span className="hidden sm:inline">Files</span>
            </TabsTrigger>
            <TabsTrigger value="fixes" className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4" />
              <span className="hidden sm:inline">Fixes</span>
            </TabsTrigger>
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg">Issue Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Status</p>
                    <p>{getStatusBadge(issue.status)}</p>
                  </div>
                  <IssueMetadata 
                    repository={issue.context?.repository}
                    issueNumber={issue.context?.githubMetadata?.issueNumber}
                    issueUrl={issue.context?.issueUrl}
                    labels={issue.context?.labels}
                    created={issue.context?.githubMetadata?.created}
                    updated={issue.context?.githubMetadata?.updated}
                  />
                </CardContent>
              </Card>

              <div className="col-span-1 md:col-span-3 space-y-6">
                {/* Show FeatureRequest component for feature requests */}
                {issue.title.toLowerCase().includes('feature request') ? (
                  <FeatureRequest 
                    title={issue.title.replace(/^Feature Request:?\s*/i, '')}
                    description={issue.description || 'No description provided'}
                    status={issue.status}
                    labels={issue.context?.labels || []}
                    priority={analysis?.severity || 'medium'}
                    complexity={analysis?.contextQuality?.score && analysis.contextQuality.score > 0.7 ? 'low' : analysis?.contextQuality?.score && analysis.contextQuality.score > 0.4 ? 'medium' : 'high'}
                  />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                        Stack Trace
                      </CardTitle>
                      <CardDescription>Error details and location</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px]">
                        {issue.stacktrace ? (
                          <CodeSnippet 
                            code={issue.stacktrace} 
                            language="plaintext" 
                            showLineNumbers={false}
                          />
                        ) : (
                          <div className="text-center py-6 text-muted-foreground">
                            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                            <p>No stack trace available</p>
                          </div>
                        )}
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {issue.error && (
                  <ErrorMessage 
                    title="Error Processing Issue"
                    message={issue.error}
                    className="mt-6"
                  />
                )}

                {/* Analysis Results */}
                {!isLoadingAnalysis && analysis ? (
                  <IssueAnalysis 
                    analysis={analysis} 
                    issueId={id}
                    className="mt-4" 
                  />
                ) : isLoadingAnalysis ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Skeleton className="h-5 w-5 rounded-full" />
                        <Skeleton className="h-6 w-40" />
                      </CardTitle>
                      <Skeleton className="h-4 w-60" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <ErrorMessage 
                    title="Analysis Not Available"
                    message="No analysis data is available for this issue. Click the 'Analyze Issue' button to generate an analysis."
                    severity="info"
                  />
                )}
              </div>
            </div>
          </TabsContent>

          {/* Context Tab */}
          <TabsContent value="context" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-500" />
                  Issue Context
                </CardTitle>
                <CardDescription>Additional debugging information</CardDescription>
              </CardHeader>
              <CardContent>
                {issue.context ? (
                  <div className="space-y-6">
                    {/* Repository Information */}
                    <div>
                      <h3 className="text-lg font-medium mb-2">Repository Information</h3>
                      <div className="bg-muted p-3 rounded-md">
                        <p><strong>Repository:</strong> {issue.context.repository || 'Unknown'}</p>
                        {issue.context.githubMetadata && (
                          <>
                            <p><strong>Owner:</strong> {issue.context.githubMetadata.owner}</p>
                            <p><strong>Repo:</strong> {issue.context.githubMetadata.repo}</p>
                            <p><strong>Issue Number:</strong> {issue.context.githubMetadata.issueNumber}</p>
                            <p><strong>Created:</strong> {new Date(issue.context.githubMetadata.created).toLocaleString()}</p>
                            <p><strong>Updated:</strong> {new Date(issue.context.githubMetadata.updated).toLocaleString()}</p>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Labels */}
                    {issue.context.labels && issue.context.labels.length > 0 && (
                      <div>
                        <h3 className="text-lg font-medium mb-2">Labels</h3>
                        <div className="flex flex-wrap gap-2">
                          {issue.context.labels.map((label, index) => (
                            <Badge key={index} variant="outline">{label}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Raw JSON */}
                    <div>
                      <h3 className="text-lg font-medium mb-2">Raw Context Data</h3>
                      <ScrollArea className="h-[300px]">
                        <CodeSnippet 
                          code={JSON.stringify(issue.context, null, 2)} 
                          language="json"
                        />
                      </ScrollArea>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2" />
                    <p>No context information available</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Code Snippets Section */}
            {issue.context?.codeSnippets && issue.context.codeSnippets.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="h-5 w-5 text-yellow-500" />
                    Code Snippets
                  </CardTitle>
                  <CardDescription>Code snippets from the issue</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {issue.context.codeSnippets.map((snippet, index) => (
                      <div key={index} className="border rounded-md p-4">
                        <h3 className="text-sm font-medium mb-2">Snippet {index + 1}</h3>
                        <CodeSnippet 
                          code={snippet} 
                          language="typescript"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Processing Logs */}
            {issue.logs && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-green-500" />
                    Processing Logs
                  </CardTitle>
                  <CardDescription>Logs from issue processing</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <CodeSnippet 
                      code={typeof issue.logs === 'string' ? issue.logs : JSON.stringify(issue.logs, null, 2)} 
                      language={typeof issue.logs === 'string' ? 'text' : 'json'}
                    />
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Files Tab */}
          <TabsContent value="files" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCode className="h-5 w-5 text-purple-500" />
                  Related Files
                </CardTitle>
                <CardDescription>Files related to this issue</CardDescription>
              </CardHeader>
              <CardContent>
                {issue.context?.files && issue.context.files.length > 0 ? (
                  <div className="space-y-4">
                    {issue.context.files.map((file, index) => (
                      <div key={index} className="border rounded-md overflow-hidden">
                        <div className="bg-muted px-4 py-2 border-b flex items-center justify-between">
                          <span className="font-medium text-sm">{file.path}</span>
                          {file.relevance !== undefined && (
                            <Badge variant="outline" className="text-xs">
                              Relevance: {(file.relevance * 100).toFixed(0)}%
                            </Badge>
                          )}
                        </div>
                        <ScrollArea className="h-[300px]">
                          <CodeSnippet 
                            code={file.content || "File content not available"} 
                            filename={file.path}
                          />
                        </ScrollArea>
                      </div>
                    ))}
                  </div>
                ) : issue.title.toLowerCase().includes('feature request') && issue.title.toLowerCase().includes('timeout') ? (
                  <div className="space-y-6">
                    <CodeImplementation
                      title="Implementation Suggestion"
                      description="Here's how you could implement custom timeout intervals in the middleware"
                      beforeCode={`import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Default timeout is 5000ms (5 seconds)
const DEFAULT_TIMEOUT = 5000;

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(request.nextUrl.toString(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Add response time header
    const nextResponse = NextResponse.next();
    nextResponse.headers.set('X-Response-Time', \`\${responseTime}ms\`);
    
    return nextResponse;
  } catch (error) {
    // Handle timeout or other errors
    return new NextResponse('Service unavailable', { status: 503 });
  }
}`}
                      afterCode={`import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Default timeout is 5000ms (5 seconds)
const DEFAULT_TIMEOUT = 5000;

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  
  // Get custom timeout from query parameter or use default
  const customTimeout = request.nextUrl.searchParams.get('timeout');
  const timeout = customTimeout ? parseInt(customTimeout, 10) : DEFAULT_TIMEOUT;
  
  try {
    const response = await fetch(request.nextUrl.toString(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Add response time header
    const nextResponse = NextResponse.next();
    nextResponse.headers.set('X-Response-Time', \`\${responseTime}ms\`);
    nextResponse.headers.set('X-Timeout-Used', \`\${timeout}ms\`);
    
    return nextResponse;
  } catch (error) {
    // Handle timeout or other errors
    return new NextResponse('Service unavailable', { status: 503 });
  }
}`}
                      explanation="This implementation adds support for custom timeout intervals by:

1. Reading a 'timeout' query parameter from the request URL
2. Converting it to an integer and using it instead of the default timeout
3. Adding an 'X-Timeout-Used' header to the response to indicate which timeout value was used
4. Maintaining backward compatibility by using the default timeout when no custom timeout is specified

This approach allows clients to specify their desired timeout on a per-request basis, making the service more flexible for different use cases."
                    />
                    
                    <CodeImplementation
                      title="Configuration-Based Approach"
                      description="Alternative implementation using configuration"
                      afterCode={`import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Timeout configuration for different endpoints or paths
const TIMEOUT_CONFIG = {
  default: 5000,  // 5 seconds
  '/api/large-data': 10000,  // 10 seconds for data-heavy endpoints
  '/api/quick': 2000,  // 2 seconds for endpoints that should be fast
};

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  
  // Determine which timeout to use based on path
  const path = request.nextUrl.pathname;
  let timeout = TIMEOUT_CONFIG.default;
  
  // Check if we have a specific timeout for this path
  for (const [configPath, configTimeout] of Object.entries(TIMEOUT_CONFIG)) {
    if (path.startsWith(configPath) && configPath !== 'default') {
      timeout = configTimeout;
      break;
    }
  }
  
  // Allow override via query parameter
  const customTimeout = request.nextUrl.searchParams.get('timeout');
  if (customTimeout) {
    timeout = parseInt(customTimeout, 10);
  }
  
  try {
    const response = await fetch(request.nextUrl.toString(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Add response time header
    const nextResponse = NextResponse.next();
    nextResponse.headers.set('X-Response-Time', \`\${responseTime}ms\`);
    nextResponse.headers.set('X-Timeout-Used', \`\${timeout}ms\`);
    
    return nextResponse;
  } catch (error) {
    // Handle timeout or other errors
    return new NextResponse('Service unavailable', { status: 503 });
  }
}`}
                      explanation="This alternative implementation provides a more sophisticated approach by:

1. Using a configuration object to define different timeout values for different API endpoints
2. Automatically selecting the appropriate timeout based on the request path
3. Still allowing runtime override via query parameter
4. Providing clear feedback about which timeout was used

This approach is more maintainable for applications with many endpoints that have different performance characteristics."
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 border rounded-lg">
                    <FileCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">No related files found</p>
                    <div className="text-sm text-muted-foreground mt-1">
                      {issue.context?.codeSnippets && issue.context.codeSnippets.length > 0 ? (
                        <>Code snippets available in the Context tab</>
                      ) : (
                        <>
                          <p>Click "Analyze Issue" to find related files</p>
                          {issue.context?.repository && (
                            <a
                              href={`https://github.com/${issue.context.repository}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1 justify-center mt-2"
                            >
                              <GitPullRequest className="h-4 w-4" />
                              View Repository on GitHub
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fixes Tab */}
          <TabsContent value="fixes" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitPullRequest className="h-5 w-5 text-green-500" />
                  Fix Attempts
                </CardTitle>
                <CardDescription>Generated solutions and pull requests</CardDescription>
              </CardHeader>
              <CardContent>
                {fixes && fixes.length > 0 ? (
                  <div className="space-y-4">
                    {fixes.map((fix, index) => (
                      <div key={fix.id}>
                        {index > 0 && <Separator className="my-4" />}
                        <div className="rounded-lg border p-4 bg-card">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              <GitPullRequest className="h-5 w-5 text-primary" />
                              <h3 className="font-medium">Pull Request #{fix.prNumber}</h3>
                              <Badge variant={fix.status === "merged" ? "secondary" : fix.status === "open" ? "outline" : "secondary"}>
                                {fix.status}
                              </Badge>
                            </div>
                            {fix.prUrl && (
                              <a
                                href={fix.prUrl}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-sm text-primary hover:underline flex items-center gap-1"
                              >
                                <GitPullRequest className="h-4 w-4" />
                                View Pull Request
                              </a>
                            )}
                            {!fix.prUrl && issue.context?.githubMetadata?.owner && issue.context?.githubMetadata?.repo && (
                              <a
                                href={createGitHubUrl(
                                  issue.context.githubMetadata.owner,
                                  issue.context.githubMetadata.repo,
                                  "pulls"
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                              >
                                <GitPullRequest className="h-4 w-4" />
                                View All PRs
                              </a>
                            )}
                          </div>
                          <div className="bg-muted p-3 rounded-md">
                            <p className="text-sm whitespace-pre-wrap">{fix.explanation}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 border rounded-lg">
                    <Terminal className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">No fixes generated yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click "Analyze Issue" to generate fixes
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
