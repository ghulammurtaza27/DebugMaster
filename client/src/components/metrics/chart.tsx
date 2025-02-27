import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Metric } from "@shared/schema";

interface MetricsChartProps {
  data: Metric[];
}

export default function MetricsChart({ data }: MetricsChartProps) {
  const chartData = data.map((metric) => ({
    date: new Date(metric.date).toLocaleDateString(),
    issues: metric.issuesProcessed,
    attempted: metric.fixesAttempted,
    succeeded: metric.fixesSucceeded,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="issues"
          name="Issues Processed"
          stroke="hsl(var(--chart-1))"
        />
        <Line
          type="monotone"
          dataKey="attempted"
          name="Fixes Attempted"
          stroke="hsl(var(--chart-2))"
        />
        <Line
          type="monotone"
          dataKey="succeeded"
          name="Fixes Succeeded"
          stroke="hsl(var(--chart-3))"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
