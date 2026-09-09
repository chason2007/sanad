'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { updateAlertRule } from '@/app/actions/settings';
import type { AlertRule, DocumentType } from '@/lib/types';

/**
 * Lead days per document type.
 *
 * Presented as removable chips rather than a comma-separated text field.
 * The person setting this is not technical, and "90, 60, 30, 7, 0" in a
 * text input invites a typo that silently deletes a reminder - the exact
 * failure this product exists to prevent.
 */
export function AlertsSettings({
  documentTypes, rules, canWrite,
}: {
  documentTypes: DocumentType[];
  rules: AlertRule[];
  canWrite: boolean;
}) {
  const ruleByType = new Map(rules.map((r) => [r.document_type_id, r]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Reminder schedule</h2>
        <p className="text-xs text-muted-foreground">
          How many days before expiry the responsible person is reminded.
          Reminders go out each morning, Dubai time.
        </p>
      </div>

      <div className="divide-y rounded-lg border">
        {documentTypes.map((type) => (
          <RuleRow
            key={type.id}
            documentType={type}
            rule={ruleByType.get(type.id) ?? null}
            canWrite={canWrite}
          />
        ))}
      </div>
    </div>
  );
}

function RuleRow({
  documentType, rule, canWrite,
}: { documentType: DocumentType; rule: AlertRule | null; canWrite: boolean }) {
  const router = useRouter();
  const defaults = documentType.default_lead_days;
  const [days, setDays] = useState<number[]>(rule?.lead_days ?? defaults);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(days) !== JSON.stringify(rule?.lead_days ?? defaults);

  function addDay() {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      toast.error('Enter a whole number of days between 0 and 365.');
      return;
    }
    if (days.includes(value)) { setDraft(''); return; }
    setDays((prev) => [...prev, value].sort((a, b) => b - a));
    setDraft('');
  }

  function save() {
    startTransition(async () => {
      const res = await updateAlertRule(documentType.id, days);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success(`Reminders updated for ${documentType.label}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium">{documentType.label}</p>
        <p className="text-2xs text-muted-foreground">
          {rule ? 'Customised' : 'Using the default schedule'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {days.map((day) => (
          <Badge key={day} variant={day <= 7 ? 'critical' : day <= 30 ? 'soon' : 'default'}>
            {day === 0 ? 'On the day' : `${day}d`}
            {canWrite && (
              <button
                type="button"
                aria-label={`Remove the ${day} day reminder`}
                onClick={() => setDays((prev) => prev.filter((d) => d !== day))}
                className="ml-1 opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}

        {canWrite && (
          <span className="flex items-center gap-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDay(); } }}
              inputMode="numeric"
              placeholder="45"
              className="h-7 w-16 text-xs"
              aria-label={`Add a reminder for ${documentType.label}`}
            />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={addDay}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>

      {canWrite && (
        <div className="flex items-center gap-1">
          {dirty && (
            <Button size="sm" onClick={save} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}Save
            </Button>
          )}
          {rule && !dirty && (
            <Button
              size="sm" variant="ghost"
              onClick={() => setDays(defaults)}
              title="Back to the default schedule"
            >
              <RotateCcw />Reset
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
