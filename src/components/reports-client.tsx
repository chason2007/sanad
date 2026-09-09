'use client';

import { useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { RegisterSummary } from '@/lib/register';
import type { Entity } from '@/lib/types';

const ALL = '__all__';

export function ReportsClient({
  entities, summary, monthLabel,
}: { entities: Entity[]; summary: RegisterSummary; monthLabel: string }) {
  const [entityId, setEntityId] = useState(ALL);

  const href = entityId === ALL ? '/api/reports' : `/api/reports?entity=${entityId}`;

  const lines = [
    { label: 'Expired', value: summary.expired },
    { label: 'Due in 7 days', value: summary.dueIn7 },
    { label: 'Due in 30 days', value: summary.dueIn30 },
    { label: 'Valid', value: summary.valid },
  ];

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          A one-page compliance summary for management. Generated fresh each
          time, dated in Dubai time.
        </p>
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <FileBarChart className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Monthly compliance report</h2>
          <span className="ml-auto text-xs text-muted-foreground">{monthLabel}</span>
        </div>

        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {lines.map((line) => (
              <div key={line.label} className="rounded-md border px-3 py-2">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">
                  {line.label}
                </dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>

          {entities.length > 1 && (
            <div className="max-w-xs space-y-1">
              <Label>Scope</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All companies</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href={href} download><Download />Download PDF</a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Contains the expired list, everything due in 90 days, and a
              per-company breakdown.
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Holder names written in Arabic appear in the PDF marked for reference.
        Export the register as CSV from the Documents screen if you need them
        in the original script.
      </p>
    </div>
  );
}
