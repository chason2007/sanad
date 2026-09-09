import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sanad (سند) means "support" or "backing" in Arabic - the thing that holds
 * your paperwork up. The mark is a shield because the job is protection
 * from fines, not analytics.
 */
export function Brand({ className, showWord = true }: { className?: string; showWord?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
        <ShieldCheck className="h-4 w-4" />
      </span>
      {showWord && <span className="text-base font-semibold tracking-tight">Sanad</span>}
    </span>
  );
}
