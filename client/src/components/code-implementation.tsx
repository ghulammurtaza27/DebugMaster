import { useState } from 'react';
import { Code, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeSnippet } from '@/components/code-snippet';
import { cn } from '@/lib/utils';

interface CodeImplementationProps {
  title: string;
  description?: string;
  beforeCode?: string;
  afterCode?: string;
  explanation?: string;
  className?: string;
}

export const CodeImplementation = ({
  title,
  description,
  beforeCode,
  afterCode,
  explanation,
  className,
}: CodeImplementationProps) => {
  const [isExplanationExpanded, setIsExplanationExpanded] = useState(false);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5 text-blue-500" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue={afterCode ? "after" : "before"} className="w-full">
          <TabsList className="grid grid-cols-2 w-full max-w-md">
            <TabsTrigger value="before" disabled={!beforeCode}>
              Before
            </TabsTrigger>
            <TabsTrigger value="after" disabled={!afterCode}>
              After
            </TabsTrigger>
          </TabsList>
          {beforeCode && (
            <TabsContent value="before" className="mt-4">
              <CodeSnippet 
                code={beforeCode} 
                language="typescript" 
                filename="Current Implementation"
              />
            </TabsContent>
          )}
          {afterCode && (
            <TabsContent value="after" className="mt-4">
              <CodeSnippet 
                code={afterCode} 
                language="typescript" 
                filename="Suggested Implementation"
              />
            </TabsContent>
          )}
        </Tabs>

        {explanation && (
          <div className="mt-4">
            <Button
              variant="ghost"
              className="flex w-full items-center justify-between p-2 text-left h-auto"
              onClick={() => setIsExplanationExpanded(!isExplanationExpanded)}
            >
              <span className="font-medium">Explanation</span>
              {isExplanationExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            <div
              className={cn(
                "overflow-hidden transition-all duration-300",
                isExplanationExpanded ? "max-h-96" : "max-h-0"
              )}
            >
              <div className="p-4 bg-muted rounded-md mt-2">
                <p className="text-sm whitespace-pre-wrap">{explanation}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 