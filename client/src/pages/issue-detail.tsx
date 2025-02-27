import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, GitPullRequest, Terminal } from "lucide-react";
import type { Issue, Fix } from "@shared/schema";

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: issue, isLoading: isLoadingIssue } = useQuery<Issue>({
    queryKey: [`/api/issues/${id}`],
  });

  const { data: fixes, isLoading: isLoadingFixes } = useQuery<Fix[]>({
    queryKey: [`/api/fixes/${id}`],
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
      <div className="p-8 space-y-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <p>Issue not found</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{issue.title}</h1>
        <Button
          onClick={() => analyzeMutation()}
          disabled={isAnalyzing || issue.status === "analyzing"}
        >
          {isAnalyzing ? "Analyzing..." : "Analyze Issue"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Stack Trace</CardTitle>
            <CardDescription>Error details and location</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="p-4 bg-muted rounded-lg overflow-auto">
              <code>{issue.stacktrace}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
            <CardDescription>Additional debugging information</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="p-4 bg-muted rounded-lg overflow-auto">
              <code>{JSON.stringify(issue.context, null, 2)}</code>
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fix Attempts</CardTitle>
          <CardDescription>Generated solutions and pull requests</CardDescription>
        </CardHeader>
        <CardContent>
          {fixes && fixes.length > 0 ? (
            <div className="space-y-4">
              {fixes.map((fix) => (
                <div
                  key={fix.id}
                  className="p-4 border rounded-lg flex items-start gap-4"
                >
                  <GitPullRequest className="h-5 w-5 mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium">Pull Request #{fix.prNumber}</h3>
                      <Badge>{fix.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {fix.explanation}
                    </p>
                    {fix.prUrl && (
                      <a
                        href={fix.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline mt-2 inline-block"
                      >
                        View Pull Request
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Terminal className="h-8 w-8 mx-auto mb-4" />
              <p>No fixes generated yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
