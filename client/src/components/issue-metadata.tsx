import { ExternalLink, Calendar, Tag, GitFork } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface IssueMetadataProps {
  repository?: string;
  issueNumber?: number;
  issueUrl?: string;
  labels?: string[];
  created?: string;
  updated?: string;
}

export const IssueMetadata = ({
  repository,
  issueNumber,
  issueUrl,
  labels = [],
  created,
  updated,
}: IssueMetadataProps) => {
  return (
    <div className="space-y-4">
      {repository && (
        <div>
          <p className="text-sm font-medium text-muted-foreground">Repository</p>
          <div className="flex items-center gap-2">
            <GitFork className="h-3.5 w-3.5 text-muted-foreground" />
            <a
              href={`https://github.com/${repository}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline text-primary flex items-center gap-1"
            >
              {repository}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {issueNumber && (
        <div>
          <p className="text-sm font-medium text-muted-foreground">Issue Number</p>
          <div className="flex items-center gap-2">
            <p className="text-sm">#{issueNumber}</p>
            {issueUrl && (
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {labels && labels.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted-foreground">Labels</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {labels.map((label, index) => (
              <div
                key={index}
                className="px-2 py-1 bg-primary/10 text-primary rounded-full text-xs flex items-center gap-1"
              >
                <Tag className="h-3 w-3" />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {created && (
        <div>
          <p className="text-sm font-medium text-muted-foreground">Created</p>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-sm">{formatDate(created)}</p>
          </div>
        </div>
      )}

      {updated && (
        <div>
          <p className="text-sm font-medium text-muted-foreground">Updated</p>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-sm">{formatDate(updated)}</p>
          </div>
        </div>
      )}
    </div>
  );
}; 