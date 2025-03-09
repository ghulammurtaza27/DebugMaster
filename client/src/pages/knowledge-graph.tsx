import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import GraphView from "@/components/knowledge-graph/graph-view";

export default function KnowledgeGraph() {
  const { toast } = useToast();

  const { mutate: analyze, isPending, error: analyzeError } = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/knowledge-graph/analyze");
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Analysis complete",
        description: "The code knowledge graph has been updated.",
      });
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'An error occurred during analysis';
      
      // Check if it's a rate limit error
      if (errorMessage.includes('rate limit')) {
        toast({
          title: "GitHub API Rate Limit Exceeded",
          description: "Too many requests to GitHub. Try again later or enable mock mode.",
          variant: "destructive",
          duration: 10000,
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    },
  });

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Knowledge Graph</h1>
        <div className="flex items-center gap-4">
          {analyzeError && (
            <div className="text-red-500 text-sm">
              {analyzeError instanceof Error ? analyzeError.message : 'Analysis failed'}
            </div>
          )}
          <Button onClick={() => analyze()} disabled={isPending}>
            {isPending ? "Analyzing..." : "Analyze Codebase"}
          </Button>
        </div>
      </div>

      <div className="h-[calc(100vh-12rem)] border rounded-lg overflow-hidden">
        <GraphView />
      </div>
    </div>
  );
}
