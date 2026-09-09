'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { renewDocument } from '@/app/actions/documents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/dates';

interface Props {
  documentId: string;
  documentLabel: string;
  holderName: string | null;
  currentExpiry: string;
  trigger?: React.ReactNode;
}

export function RenewDialog({ documentId, documentLabel, holderName, currentExpiry, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('document_id', documentId);

    startTransition(async () => {
      const result = await renewDocument(formData);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not record the renewal.');
        return;
      }
      toast.success('Renewal recorded. The old document is kept in the history.');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <CheckCircle2 />
            Mark renewed
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark renewed</DialogTitle>
          <DialogDescription>
            {documentLabel}
            {holderName ? ` for ${holderName}` : ''} - currently expiring{' '}
            {formatDate(currentExpiry)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new_expiry_date">New expiry date</Label>
            <Input
              id="new_expiry_date"
              name="new_expiry_date"
              type="date"
              required
              min={currentExpiry}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new_issue_date">New issue date (optional)</Label>
            <Input id="new_issue_date" name="new_issue_date" type="date" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new_document_number">New document number (optional)</Label>
            <Input
              id="new_document_number"
              name="new_document_number"
              placeholder="Leave blank to keep the current number"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="file">Replacement file (optional)</Label>
            <Input id="file" name="file" type="file" accept="image/*,application/pdf" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="Anything worth remembering next time." />
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            The expiring document is kept and linked to this renewal, so the
            history stays intact.
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save renewal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
