import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import GraphView from "@/components/knowledge-graph/graph-view";

export default function KnowledgeGraph() {
  const { toast } = useToast();

  const { mutate: analyze, isPending } = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/knowledge-graph/analyze");
    },
    onSuccess: () => {
      toast({
        title: "Analysis complete",
        description: "The code knowledge graph has been updated.",
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

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Knowledge Graph</h1>
        <Button onClick={() => analyze()} disabled={isPending}>
          {isPending ? "Analyzing..." : "Analyze Codebase"}
        </Button>
      </div>

      <div className="h-[calc(100vh-12rem)] border rounded-lg overflow-hidden">
        <GraphView />
      </div>
    </div>
  );
}
