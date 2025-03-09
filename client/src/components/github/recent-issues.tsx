import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Issue } from "@shared/schema";

// Define the possible badge variants that match your UI component
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function RecentIssues() {
  const { data: issues, isLoading } = useQuery<Issue[]>({
    queryKey: ["/api/issues"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Issues</CardTitle>
          <CardDescription>Latest issues being processed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Issues</CardTitle>
        <CardDescription>Latest issues being processed</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {issues?.slice(0, 5).map((issue) => (
            <div
              key={issue.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div>
                <h3 className="font-medium">{issue.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {(issue.context as { repository: string }).repository}
                </p>
              </div>
              <Badge variant={getStatusVariant(issue.status)}>
                {issue.status}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Update the return type to match Badge variant options
function getStatusVariant(status: string): BadgeVariant {
  switch (status.toLowerCase()) {
    case 'new':
      return 'default';
    case 'analyzing':
      return 'secondary';
    case 'fixed':
      return 'outline';
    case 'failed':
      return 'destructive';
    default:
      return 'default';
  }
} 