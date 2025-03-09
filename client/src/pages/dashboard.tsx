import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import MetricsChart from "@/components/metrics/chart";
import { GithubIssueImport } from "@/components/github/issue-import";
import type { Metric } from "@shared/schema";

export default function Dashboard() {
  const { data: metrics, isLoading } = useQuery<Metric[]>({
    queryKey: ["/api/metrics"],
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const latestMetric = metrics?.[metrics.length - 1];

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <GithubIssueImport />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Issues Processed</CardTitle>
            <CardDescription>Total issues analyzed</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {latestMetric?.issuesProcessed || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
            <CardDescription>Fixes successfully merged</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {latestMetric
                ? Math.round(
                    (latestMetric.fixesSucceeded / latestMetric.fixesAttempted) *
                      100
                  )
                : 0}
              %
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avg. Processing Time</CardTitle>
            <CardDescription>Time to generate fixes</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {latestMetric?.avgProcessingTime || 0}s
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance Over Time</CardTitle>
          <CardDescription>Last 30 days of metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-96">
            <MetricsChart data={metrics || []} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
