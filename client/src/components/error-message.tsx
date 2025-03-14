import { AlertCircle, AlertTriangle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ErrorSeverity = 'error' | 'warning' | 'info';

interface ErrorMessageProps {
  title: string;
  message: string;
  severity?: ErrorSeverity;
  className?: string;
  actions?: React.ReactNode;
}

export const ErrorMessage = ({
  title,
  message,
  severity = 'error',
  className,
  actions,
}: ErrorMessageProps) => {
  const getSeverityStyles = () => {
    switch (severity) {
      case 'error':
        return {
          containerClass: 'border-red-200 bg-red-50 dark:bg-red-950/10',
          iconClass: 'text-red-500',
          icon: <XCircle className="h-6 w-6" />,
        };
      case 'warning':
        return {
          containerClass: 'border-amber-200 bg-amber-50 dark:bg-amber-950/10',
          iconClass: 'text-amber-500',
          icon: <AlertTriangle className="h-6 w-6" />,
        };
      case 'info':
        return {
          containerClass: 'border-blue-200 bg-blue-50 dark:bg-blue-950/10',
          iconClass: 'text-blue-500',
          icon: <Info className="h-6 w-6" />,
        };
      default:
        return {
          containerClass: 'border-red-200 bg-red-50 dark:bg-red-950/10',
          iconClass: 'text-red-500',
          icon: <AlertCircle className="h-6 w-6" />,
        };
    }
  };

  const { containerClass, iconClass, icon } = getSeverityStyles();

  return (
    <div className={cn('rounded-lg border p-4', containerClass, className)}>
      <div className="flex items-start gap-3">
        <div className={iconClass}>{icon}</div>
        <div className="flex-1">
          <h3 className="text-lg font-medium mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{message}</p>
          {actions && <div className="mt-4">{actions}</div>}
        </div>
      </div>
    </div>
  );
}; 