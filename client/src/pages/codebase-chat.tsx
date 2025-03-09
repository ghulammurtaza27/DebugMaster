import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

interface ChatMessage {
  id: number;
  content: string;
  isUser: boolean;
  timestamp: string;
}

export default function CodebaseChat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const { user, isLoading: isLoadingAuth } = useAuth();
  const [, setLocation] = useLocation();
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoadingAuth && !user) {
      toast({
        title: "Authentication required",
        description: "Please log in to use the codebase chat feature.",
        variant: "destructive",
      });
      setLocation("/auth");
    }
  }, [user, isLoadingAuth, setLocation, toast]);
  
  // Fetch chat history
  const { data: chatHistory = [], isLoading: isLoadingHistory, error: historyError } = useQuery<ChatMessage[]>({
    queryKey: ["/api/codebase-chat"],
    queryFn: async () => {
      try {
        if (!user) return [];
        const response = await apiRequest("GET", "/api/codebase-chat");
        return response;
      } catch (error) {
        console.error("Error fetching chat history:", error);
        throw error;
      }
    },
    enabled: !!user, // Only run query if user is authenticated
  });
  
  // Check if repository has been analyzed
  const { data: knowledgeGraphData, isLoading: isLoadingGraph } = useQuery({
    queryKey: ["/api/knowledge-graph"],
    queryFn: async () => {
      try {
        if (!user) return null;
        const response = await apiRequest("GET", "/api/knowledge-graph");
        return response;
      } catch (error) {
        console.error("Error fetching knowledge graph:", error);
        return null;
      }
    },
    enabled: !!user,
  });
  
  // Determine if the repository has been analyzed
  const hasAnalyzedRepo = knowledgeGraphData && 
    knowledgeGraphData.nodes && 
    knowledgeGraphData.nodes.length > 0;
  
  // Send a message
  const { mutate: sendMessage, isPending: isSending, error: sendError } = useMutation({
    mutationFn: async (question: string) => {
      try {
        if (!user) {
          throw new Error("You must be logged in to send messages");
        }
        
        console.log("Sending message:", question);
        const response = await apiRequest("POST", "/api/codebase-chat", { question });
        console.log("Response received:", response);
        return response;
      } catch (error) {
        console.error("Error sending message:", error);
        throw error;
      }
    },
    onSuccess: () => {
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["/api/codebase-chat"] });
    },
    onError: (error) => {
      console.error("Chat error details:", error);
      
      // Check if it's an authentication error
      if (error.message && error.message.includes("Authentication required")) {
        toast({
          title: "Authentication required",
          description: "Please log in to use the codebase chat feature.",
          variant: "destructive",
        });
        setLocation("/auth");
        return;
      }
      
      toast({
        title: "Error sending message",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Clear chat history
  const { mutate: clearHistory, isPending: isClearing } = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/codebase-chat");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/codebase-chat"] });
      toast({
        title: "Chat history cleared",
        description: "Your conversation history has been deleted.",
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
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim() && !isSending && hasAnalyzedRepo) {
      sendMessage(question);
    } else if (!hasAnalyzedRepo) {
      toast({
        title: "Repository not analyzed",
        description: "You need to analyze your repository in the Knowledge Graph section first.",
        variant: "destructive",
      });
    }
  };
  
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Codebase Chat</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => clearHistory()}
          disabled={isClearing || chatHistory.length === 0}
        >
          {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Clear History
        </Button>
      </div>
      
      <div className="text-sm text-muted-foreground">
        Ask questions about your codebase and get AI-powered answers based on the analyzed repository.
      </div>
      
      {!hasAnalyzedRepo && !isLoadingGraph && (
        <Alert variant="destructive">
          <AlertTitle>Repository not analyzed</AlertTitle>
          <AlertDescription>
            You need to analyze your repository in the Knowledge Graph section before you can chat with it.
            <div className="mt-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setLocation("/knowledge-graph")}
              >
                Go to Knowledge Graph
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      {chatHistory.length === 0 && !isLoadingHistory && hasAnalyzedRepo && (
        <Alert>
          <AlertTitle>No conversation history</AlertTitle>
          <AlertDescription>
            Start by asking a question about your codebase.
          </AlertDescription>
        </Alert>
      )}
      
      <Card className="border rounded-lg">
        <ScrollArea className="h-[calc(100vh-16rem)] p-4">
          {isLoadingHistory ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {chatHistory.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex gap-3 max-w-[80%] ${message.isUser ? "flex-row-reverse" : ""}`}>
                    <Avatar className={message.isUser ? "bg-primary" : "bg-secondary"}>
                      <AvatarFallback>{message.isUser ? "You" : "AI"}</AvatarFallback>
                      {!message.isUser && (
                        <AvatarImage src="/ai-assistant.png" alt="AI Assistant" />
                      )}
                    </Avatar>
                    <div
                      className={`rounded-lg p-3 ${
                        message.isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                      <div className="text-xs mt-1 opacity-70">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        
        <CardContent className="p-4 border-t">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about your codebase..."
              disabled={isSending}
              className="flex-1"
            />
            <Button 
              type="submit" 
              disabled={isSending || !question.trim() || !hasAnalyzedRepo}
              title={!hasAnalyzedRepo ? "Repository not analyzed" : ""}
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="ml-2">Send</span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
} 