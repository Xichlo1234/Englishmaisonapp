import * as React from 'react';
import { cn } from '@/lib/utils';

const fmt = (n: number | null) => (n === null ? '' : n.toLocaleString('vi-VN').replace(/,/g, '.'));

/** Ô nhập tiền VND: hiển thị 1.800.000, giá trị là số nguyên (null khi trống). */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={fmt(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
          onChange(digits ? Number(digits) : null);
        }}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background py-1 pl-3 pr-8 text-right text-sm tabular-nums shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive',
          className,
        )}
        {...props}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₫</span>
    </div>
  );
}
