import { useState } from 'react';
import { ChevronDown, ChevronRight, File, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FileChange {
  path: string;
  changes: {
    added: string[];
    removed: string[];
  };
}

interface FileChangesProps {
  changes: FileChange[];
  className?: string;
}

export const FileChanges = ({ changes, className }: FileChangesProps) => {
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  if (!changes || changes.length === 0) {
    return (
      <div className={cn("text-center py-6 text-muted-foreground", className)}>
        <File className="h-8 w-8 mx-auto mb-2" />
        <p>No file changes available</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {changes.map((file) => (
        <div key={file.path} className="border rounded-md overflow-hidden">
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-3 text-left h-auto"
            onClick={() => toggleFile(file.path)}
            aria-expanded={expandedFiles[file.path]}
            tabIndex={0}
          >
            <div className="flex items-center gap-2">
              <File className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm truncate">{file.path}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 px-2 py-1 rounded-full flex items-center gap-1">
                <Plus className="h-3 w-3" />
                {file.changes.added.length}
              </span>
              <span className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 px-2 py-1 rounded-full flex items-center gap-1">
                <Minus className="h-3 w-3" />
                {file.changes.removed.length}
              </span>
              {expandedFiles[file.path] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          </Button>
          
          {expandedFiles[file.path] && (
            <ScrollArea className="max-h-[400px] border-t">
              <div className="p-0">
                <pre className="text-sm">
                  <code>
                    {file.changes.removed.map((line, i) => (
                      <div key={`removed-${i}`} className="bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30 px-4 py-0.5 flex">
                        <span className="text-red-800 dark:text-red-200 select-none w-8 text-right pr-4">-</span>
                        <span className="text-red-800 dark:text-red-200">{line}</span>
                      </div>
                    ))}
                    {file.changes.added.map((line, i) => (
                      <div key={`added-${i}`} className="bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30 px-4 py-0.5 flex">
                        <span className="text-green-800 dark:text-green-200 select-none w-8 text-right pr-4">+</span>
                        <span className="text-green-800 dark:text-green-200">{line}</span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </ScrollArea>
          )}
        </div>
      ))}
    </div>
  );
}; 