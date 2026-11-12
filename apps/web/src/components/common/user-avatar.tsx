import { fileUrl } from '@/lib/image';
import { cn } from '@/lib/utils';

export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Round avatar: uploaded photo, or initials on the brand tint when there is none. */
export function UserAvatar({ name, fileId, className }: { name: string; fileId: number | null | undefined; className?: string }) {
  return fileId ? (
    <img src={fileUrl(fileId)} alt={`Ảnh đại diện ${name}`} className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', className)} />
  ) : (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground ring-2 ring-white', className)}>
      {initialsOf(name)}
    </span>
  );
}
