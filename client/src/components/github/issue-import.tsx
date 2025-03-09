import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function GithubIssueImport() {
  const [issueUrl, setIssueUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const response = await fetch('http://localhost:5000/api/issues/github', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ issueUrl }),
      });

      if (!response.ok) {
        throw new Error('Failed to process issue');
      }

      const issue = await response.json();
      
      toast({
        title: 'Issue imported successfully',
        description: `Issue "${issue.title}" has been added and analysis started.`,
      });

      await queryClient.invalidateQueries({ queryKey: ['/api/metrics'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/issues'] });

      setIssueUrl('');
    } catch (error) {
      toast({
        title: 'Error importing issue',
        description: 'Failed to import GitHub issue. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import GitHub Issue</CardTitle>
        <CardDescription>
          Paste a GitHub issue URL to analyze and generate fixes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="url"
            placeholder="https://github.com/owner/repo/issues/123"
            value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)}
            required
            pattern="https://github\.com/.+/.+/issues/\d+"
          />
          <Button type="submit" className="w-full" disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Import and Analyze Issue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
} 