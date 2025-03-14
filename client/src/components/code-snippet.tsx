import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeSnippetProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export const CodeSnippet = ({
  code,
  language = 'typescript',
  filename,
  showLineNumbers = true,
  className,
}: CodeSnippetProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');

  return (
    <div className={cn('rounded-md overflow-hidden border', className)}>
      {filename && (
        <div className="bg-muted px-4 py-2 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{filename}</span>
          <button
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md"
            aria-label="Copy code"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleCopy()}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
      <div className="relative bg-muted">
        {!filename && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md bg-background/80"
            aria-label="Copy code"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleCopy()}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        )}
        <div className="p-4 overflow-x-auto">
          <pre className="text-sm">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="table-row">
                  {showLineNumbers && (
                    <span className="table-cell text-right pr-4 select-none text-muted-foreground text-xs w-8">
                      {i + 1}
                    </span>
                  )}
                  <span className="table-cell">{line}</span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}; 