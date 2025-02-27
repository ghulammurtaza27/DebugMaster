import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/components/auth/protected-route";
import Dashboard from "@/pages/dashboard";
import Issues from "@/pages/issues";
import IssueDetail from "@/pages/issue-detail";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/layout/sidebar";
import KnowledgeGraph from "@/pages/knowledge-graph";
import Auth from "@/pages/auth";
import Pricing from "@/pages/pricing";

function Router() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Switch>
          <Route path="/auth" component={Auth} />
          <Route path="/pricing" component={Pricing} />
          <ProtectedRoute path="/" component={Dashboard} />
          <ProtectedRoute path="/issues" component={Issues} />
          <ProtectedRoute path="/issues/:id" component={IssueDetail} />
          <ProtectedRoute path="/settings" component={Settings} />
          <ProtectedRoute path="/knowledge-graph" component={KnowledgeGraph} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;