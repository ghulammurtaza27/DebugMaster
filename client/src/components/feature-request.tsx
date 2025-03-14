import { Lightbulb, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

interface FeatureRequestProps {
  title: string;
  description?: string;
  status?: string;
  priority?: 'high' | 'medium' | 'low';
  complexity?: 'high' | 'medium' | 'low';
  estimatedTime?: string;
  assignee?: string;
  labels?: string[];
  onApprove?: () => void;
  onReject?: () => void;
  className?: string;
}

export const FeatureRequest = ({
  title,
  description = 'No description provided',
  status = 'pending',
  priority = 'medium',
  complexity = 'medium',
  estimatedTime,
  assignee,
  labels = [],
  onApprove,
  onReject,
  className,
}: FeatureRequestProps) => {
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Rejected</Badge>;
      case 'in progress':
        return <Badge variant="secondary" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      default:
        return <Badge variant="outline" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Pending</Badge>;
    }
  };

  const getPriorityBadge = (priority: 'high' | 'medium' | 'low') => {
    switch (priority) {
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

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          Feature Request
        </CardTitle>
        <CardDescription>Details about the requested feature</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center justify-between">
            Status
            <span>{getStatusBadge(status)}</span>
          </h3>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground mt-2">{description}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Priority</h3>
            <div>{getPriorityBadge(priority)}</div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Complexity</h3>
            <div>{getPriorityBadge(complexity)}</div>
          </div>
          {estimatedTime && (
            <div>
              <h3 className="text-sm font-medium mb-2">Estimated Time</h3>
              <p className="text-sm">{estimatedTime}</p>
            </div>
          )}
          {assignee && (
            <div>
              <h3 className="text-sm font-medium mb-2">Assignee</h3>
              <p className="text-sm">{assignee}</p>
            </div>
          )}
        </div>

        {labels.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">Labels</h3>
            <div className="flex flex-wrap gap-2">
              {labels.map((label, index) => (
                <Badge key={index} variant="outline">{label}</Badge>
              ))}
            </div>
          </div>
        )}

        {(onApprove || onReject) && (
          <>
            <Separator />
            <div className="flex justify-end gap-2">
              {onReject && (
                <Button variant="outline" onClick={onReject}>
                  Reject
                </Button>
              )}
              {onApprove && (
                <Button onClick={onApprove}>
                  Approve
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}; 