import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Ngăn kéo bên phải — dùng cho form thay vì cửa sổ bật lên. */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100" aria-label="Đóng">
          <X className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-6', className)} {...props} />;
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-auto flex gap-2 pt-2 sm:justify-end', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter };
