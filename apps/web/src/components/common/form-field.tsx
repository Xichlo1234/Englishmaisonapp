import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function FormField({
  label,
  htmlFor,
  error,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
