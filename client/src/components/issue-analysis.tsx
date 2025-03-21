import { AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, XCircle, GitPullRequest } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { FileChanges } from '@/components/file-changes';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface CodeChange {
  lineStart: number;
  lineEnd: number;
  oldCode: string;
  newCode: string;
  explanation: string;
}

interface FileChange {
  file: string;
  changes: CodeChange[];
}

interface AnalysisResult {
  rootCause: string;
  severity: 'high' | 'medium' | 'low';
  impactedComponents: string[];
  fix?: {
    changes: FileChange[];
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

interface IssueAnalysisProps {
  analysis: AnalysisResult;
  issueId: number;
  className?: string;
}

export const IssueAnalysis = ({ analysis, issueId, className }: IssueAnalysisProps) => {
  const { toast } = useToast();

  const createPRMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/issues/${issueId}/create-pr`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to create pull request');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Pull Request Created",
        description: "The pull request has been created successfully.",
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

  const handleCreatePR = () => {
    createPRMutation.mutate();
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high':
        return 'bg-red-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'low':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (!analysis) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Analysis Results
          <Badge className={getSeverityColor(analysis.severity)}>
            {analysis.severity.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Root Cause</h3>
          <p>{analysis.rootCause}</p>
        </div>

        {analysis.impactedComponents.length > 0 && (
          <div>
            <h3 className="font-semibold mb-2">Impacted Components</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.impactedComponents.map((component, index) => (
                <Badge key={index} variant="outline">
                  {component}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {analysis.fix?.changes && (
          <div>
            <h3 className="font-semibold mb-2">Suggested Changes</h3>
            <div className="space-y-4">
              {analysis.fix.changes.map((fileChange, fileIndex) => (
                <div key={fileIndex} className="border rounded-lg p-4">
                  <h4 className="font-medium mb-2">{fileChange.file}</h4>
                  {fileChange.changes.map((change, changeIndex) => (
                    <div key={changeIndex} className="space-y-2">
                      <p className="text-sm text-muted-foreground">{change.explanation}</p>
                      <div className="bg-muted p-4 rounded-md">
                        <div className="mb-2">
                          <div className="text-sm font-mono bg-red-100 dark:bg-red-900/30 p-2 rounded">
                            <pre className="whitespace-pre-wrap">{change.oldCode || '(No previous code)'}</pre>
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-mono bg-green-100 dark:bg-green-900/30 p-2 rounded">
                            <pre className="whitespace-pre-wrap">{change.newCode}</pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.noFixReason && (
          <div className="text-yellow-600 dark:text-yellow-400">
            <p>{analysis.noFixReason}</p>
          </div>
        )}

        {analysis.diagnostics && (
          <div>
            <h3 className="font-semibold mb-2">Diagnostics</h3>
            <p>{analysis.diagnostics.message}</p>
            {analysis.diagnostics.reasons.length > 0 && (
              <div className="mt-2">
                <h4 className="font-medium">Reasons:</h4>
                <ul className="list-disc list-inside">
                  {analysis.diagnostics.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
      
      {analysis.fix?.changes && (
        <CardFooter>
          <Button
            onClick={handleCreatePR}
            disabled={createPRMutation.isPending}
            className="w-full"
          >
            <GitPullRequest className="w-4 h-4 mr-2" />
            {createPRMutation.isPending ? "Creating Pull Request..." : "Create Pull Request"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}; 