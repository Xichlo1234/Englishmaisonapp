import * as React from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

/** ISO 'YYYY-MM-DD' → 'dd/mm/yyyy' */
export function isoToVn(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 'dd/mm/yyyy' → ISO 'YYYY-MM-DD'; null nếu không hợp lệ (kể cả ngày không tồn tại như 30/02). */
export function vnToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Tự chèn dấu "/" khi gõ số: 12042016 → 12/04/2016 */
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export interface DateInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'defaultValue'> {
  /** Giá trị ISO 'YYYY-MM-DD' hoặc '' */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
}

/**
 * Ô nhập ngày luôn hiển thị dd/mm/yyyy (không phụ thuộc ngôn ngữ trình duyệt).
 * Gõ trực tiếp hoặc bấm biểu tượng lịch để chọn. Giá trị trả ra dạng ISO để gửi API.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, min, max, className, disabled, onBlur, ...props },
  ref,
) {
  const [text, setText] = React.useState(isoToVn(value));
  const picker = React.useRef<HTMLInputElement>(null);
  const lastIso = React.useRef(value ?? '');

  // Đồng bộ khi giá trị bên ngoài thay đổi (reset form, chọn từ lịch…)
  React.useEffect(() => {
    if ((value ?? '') !== lastIso.current) {
      lastIso.current = value ?? '';
      setText(isoToVn(value));
    }
  }, [value]);

  const emit = (iso: string) => {
    lastIso.current = iso;
    onChange(iso);
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const t = maskDate(e.target.value);
          setText(t);
          if (!t) emit('');
          else {
            const iso = vnToIso(t);
            if (iso) emit(iso);
            else if (t.length === 10) emit('');
          }
        }}
        onBlur={(e) => {
          const iso = vnToIso(text);
          if (text && !iso) {
            // ngày không hợp lệ → xóa để người dùng nhập lại
            setText('');
            emit('');
          } else if (iso) setText(isoToVn(iso));
          onBlur?.(e);
        }}
        className={cn(
          'flex h-9 w-full min-w-0 rounded-md border border-input bg-background py-1 pl-3 pr-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive',
          className,
        )}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Chọn ngày trên lịch"
        className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-50"
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        <CalendarDays className="size-4" />
      </button>
      {/* Bộ chọn lịch gốc của trình duyệt (ẩn), chỉ dùng để chọn nhanh */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => {
          setText(isoToVn(e.target.value));
          emit(e.target.value);
        }}
      />
    </div>
  );
});

/** Ô nhập giờ dạng 24h HH:MM (không phụ thuộc AM/PM của trình duyệt). */
export function TimeInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & { value: string; onChange: (v: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
        const t = digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
        setText(t);
        onChange(/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '');
      }}
      onBlur={() => {
        if (text && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
          setText('');
          onChange('');
        }
      }}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 font-mono text-sm shadow-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
        className,
      )}
      {...props}
    />
  );
}
