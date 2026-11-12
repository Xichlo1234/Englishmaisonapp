import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex w-full gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    variant: {
      default: 'bg-background',
      warning: 'border-yellow-300 bg-warning-soft text-yellow-900',
      destructive: 'border-red-200 bg-danger-soft text-red-800',
      success: 'border-green-200 bg-success-soft text-green-900',
      info: 'border-blue-200 bg-accent text-accent-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert };
