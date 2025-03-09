import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export function IssueImportForm() {
  const [issueUrl, setIssueUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const response = await fetch('/api/issues/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueUrl }),
      });

      if (!response.ok) throw new Error('Failed to process issue');

      const issue = await response.json();
      
      toast({
        title: 'Issue imported successfully',
        description: `Issue "${issue.title}" has been added and analysis started.`,
      });

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        type="url"
        placeholder="Enter GitHub issue URL"
        value={issueUrl}
        onChange={(e) => setIssueUrl(e.target.value)}
        required
        pattern="https://github\.com/[^/]+/[^/]+/issues/\d+"
      />
      <Button type="submit" disabled={isProcessing}>
        {isProcessing ? 'Processing...' : 'Import GitHub Issue'}
      </Button>
    </form>
  );
} 