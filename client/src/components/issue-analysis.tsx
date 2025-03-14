import { AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

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

interface IssueAnalysisProps {
  analysis: AnalysisResult;
  className?: string;
}

export const IssueAnalysis = ({ analysis, className }: IssueAnalysisProps) => {
  if (!analysis) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
            Analysis
          </CardTitle>
          <CardDescription>No analysis available yet</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <p>Run analysis to get insights about this issue</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSeverityBadge = (severity?: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> High</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Medium</Badge>;
      case 'low':
        return <Badge variant="outline" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Low</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getQualityIndicator = (score?: number) => {
    if (score === undefined) return null;
    
    if (score >= 0.7) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Good</Badge>;
    } else if (score >= 0.4) {
      return <Badge variant="secondary" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Moderate</Badge>;
    } else {
      return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Poor</Badge>;
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          Analysis Results
        </CardTitle>
        <CardDescription>AI-powered issue analysis</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {analysis.rootCause && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              Root Cause
              {analysis.severity && (
                <span className="ml-auto">{getSeverityBadge(analysis.severity)}</span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">{analysis.rootCause}</p>
          </div>
        )}

        {analysis.impactedComponents && analysis.impactedComponents.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">Impacted Components</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.impactedComponents.map((component, index) => (
                <Badge key={index} variant="outline">{component}</Badge>
              ))}
            </div>
          </div>
        )}

        {analysis.noFixReason && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              No Fix Available
            </h3>
            <p className="text-sm text-muted-foreground">{analysis.noFixReason}</p>
          </div>
        )}

        {analysis.contextQuality && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                Context Quality
                <span className="ml-auto">{getQualityIndicator(analysis.contextQuality.score)}</span>
              </h3>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center p-2 border rounded-md">
                  <p className="text-xs text-muted-foreground">Stack Trace</p>
                  {analysis.contextQuality.hasStacktrace ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mt-1" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500 mx-auto mt-1" />
                  )}
                </div>
                <div className="text-center p-2 border rounded-md">
                  <p className="text-xs text-muted-foreground">Code Snippets</p>
                  {analysis.contextQuality.hasCodeSnippets ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mt-1" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500 mx-auto mt-1" />
                  )}
                </div>
                <div className="text-center p-2 border rounded-md">
                  <p className="text-xs text-muted-foreground">Relevant Files</p>
                  {analysis.contextQuality.hasRelevantFiles ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mt-1" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500 mx-auto mt-1" />
                  )}
                </div>
              </div>
              {analysis.contextQuality.suggestions && analysis.contextQuality.suggestions.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1">Suggestions to improve analysis:</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {analysis.contextQuality.suggestions.map((suggestion, index) => (
                      <li key={index}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}

        {analysis.diagnostics && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-medium mb-2">Diagnostics</h3>
              {analysis.diagnostics.message && (
                <p className="text-sm text-muted-foreground mb-2">{analysis.diagnostics.message}</p>
              )}
              
              {analysis.diagnostics.reasons && analysis.diagnostics.reasons.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium mb-1">Reasons:</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {analysis.diagnostics.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {analysis.diagnostics.suggestions && analysis.diagnostics.suggestions.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1">Suggestions:</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {analysis.diagnostics.suggestions.map((suggestion, index) => (
                      <li key={index}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}; 