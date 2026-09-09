'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  UploadCloud, Loader2, AlertTriangle, CheckCircle2, X, FileText, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { confirmExtraction, discardExtraction, getStagedFileUrl } from '@/app/actions/extraction';
import { formatDate } from '@/lib/dates';
import {
  HOLDER_TYPES, HOLDER_TYPE_LABELS,
  type DocumentType, type Entity, type Holder, type Profile,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const NEW_HOLDER = '__new__';
const NO_HOLDER = '__none__';

interface ExtractResponse {
  job_id: string;
  status: string;
  confidence: number;
  warnings: string[];
  error: string | null;
  needs_review: boolean;
  file_name: string;
  fields: {
    document_type_code: string;
    document_number: string | null;
    holder_name: string | null;
    issue_date: string | null;
    expiry_date: string | null;
    reasoning: string;
  } | null;
}

type Item =
  | { state: 'uploading'; id: string; fileName: string }
  | { state: 'error'; id: string; fileName: string; message: string }
  | { state: 'ready'; id: string; result: ExtractResponse }
  | { state: 'saved'; id: string; fileName: string; documentId: string };

interface Props {
  entities: Entity[];
  documentTypes: DocumentType[];
  holders: Holder[];
  team: Profile[];
  defaultResponsibleId: string;
}

export function UploadClient({
  entities, documentTypes, holders, team, defaultResponsibleId,
}: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!entityId) {
        toast.error('Add a company first.');
        return;
      }

      for (const file of Array.from(files)) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setItems((prev) => [...prev, { state: 'uploading', id, fileName: file.name }]);

        const body = new FormData();
        body.set('file', file);
        body.set('entity_id', entityId);

        try {
          const response = await fetch('/api/extract', { method: 'POST', body });
          const json = await response.json();

          if (!response.ok) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === id
                  ? { state: 'error', id, fileName: file.name, message: json.error ?? 'Upload failed.' }
                  : item,
              ),
            );
            continue;
          }

          setItems((prev) =>
            prev.map((item) => (item.id === id ? { state: 'ready', id, result: json } : item)),
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? { state: 'error', id, fileName: file.name, message: (err as Error).message }
                : item,
            ),
          );
        }
      }
    },
    [entityId],
  );

  const pendingReview = items.filter((i) => i.state === 'ready').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload documents</h1>
        <p className="text-sm text-muted-foreground">
          Sanad reads the dates off each file. You confirm them before anything is saved.
        </p>
      </div>

      {entities.length > 1 && (
        <div className="max-w-sm space-y-1">
          <Label>Company these documents belong to</Label>
          <Select value={entityId} onValueChange={setEntityId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {entities.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>{entity.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'cursor-pointer rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40',
        )}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Drop files here, or click to choose</p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, JPG, PNG or WEBP. Up to 15 MB each. Several at once is fine.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {pendingReview > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {pendingReview} {pendingReview === 1 ? 'document is' : 'documents are'} waiting for you
          to confirm. Nothing is saved until you do.
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          if (item.state === 'uploading') {
            return (
              <div key={item.id} className="flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="font-medium">{item.fileName}</span>
                <span className="text-muted-foreground">Reading the document...</span>
              </div>
            );
          }

          if (item.state === 'error') {
            return (
              <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="font-medium">{item.fileName}</span>
                <span>{item.message}</span>
                <Button
                  variant="ghost" size="sm" className="ml-auto"
                  onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                >
                  <X />
                </Button>
              </div>
            );
          }

          if (item.state === 'saved') {
            return (
              <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok-ink">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-medium">{item.fileName}</span>
                <span>saved to the register.</span>
              </div>
            );
          }

          return (
            <ReviewCard
              key={item.id}
              result={item.result}
              entityId={entityId}
              documentTypes={documentTypes}
              holders={holders.filter((h) => h.entity_id === entityId)}
              team={team}
              defaultResponsibleId={defaultResponsibleId}
              onSaved={(documentId) =>
                setItems((prev) =>
                  prev.map((i) =>
                    i.id === item.id
                      ? { state: 'saved', id: item.id, fileName: item.result.file_name, documentId }
                      : i,
                  ),
                )
              }
              onDiscarded={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReviewCard({
  result, entityId, documentTypes, holders, team, defaultResponsibleId, onSaved, onDiscarded,
}: {
  result: ExtractResponse;
  entityId: string;
  documentTypes: DocumentType[];
  holders: Holder[];
  team: Profile[];
  defaultResponsibleId: string;
  onSaved: (documentId: string) => void;
  onDiscarded: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [holderChoice, setHolderChoice] = useState<string>(() => {
    const suggested = result.fields?.holder_name?.trim().toLowerCase();
    const match = suggested
      ? holders.find((h) => h.name.trim().toLowerCase() === suggested)
      : undefined;
    if (match) return match.id;
    return suggested ? NEW_HOLDER : NO_HOLDER;
  });

  const matchedType = documentTypes.find((t) => t.code === result.fields?.document_type_code);
  const [typeId, setTypeId] = useState(matchedType?.id ?? '');

  const lowConfidence = result.needs_review;

  async function openPreview() {
    const res = await getStagedFileUrl(result.job_id);
    if (!res.ok || !res.url) { toast.error(res.error ?? 'Could not open the file.'); return; }
    setPreviewUrl(res.url);
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('job_id', result.job_id);
    formData.set('entity_id', entityId);
    if (holderChoice !== NEW_HOLDER && holderChoice !== NO_HOLDER) {
      formData.set('holder_id', holderChoice);
    }

    startTransition(async () => {
      const res = await confirmExtraction(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Saved to the register.');
      onSaved(res.documentId!);
      router.refresh();
    });
  }

  function discard() {
    startTransition(async () => {
      const res = await discardExtraction(result.job_id);
      if (!res.ok) { toast.error(res.error ?? 'Could not discard.'); return; }
      onDiscarded();
    });
  }

  return (
    <div
      className={cn(
        'rounded-lg border',
        lowConfidence ? 'border-warn/40 bg-warn-soft/30' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{result.file_name}</span>

        {result.error ? (
          <Badge variant="expired">Could not read</Badge>
        ) : lowConfidence ? (
          <Badge variant="soon">Needs review · {Math.round(result.confidence * 100)}% sure</Badge>
        ) : (
          <Badge variant="ok">Read cleanly · {Math.round(result.confidence * 100)}% sure</Badge>
        )}

        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={openPreview}>
          <Eye />View scan
        </Button>
      </div>

      {(result.error || result.warnings.length > 0) && (
        <div className="border-b bg-warn-soft/60 px-4 py-2.5 text-xs text-warn-ink">
          {result.error && <p className="font-medium">{result.error} Enter the details by hand below.</p>}
          {result.warnings.map((warning) => (
            <p key={warning}>· {warning}</p>
          ))}
          {result.fields?.reasoning && !result.error && (
            <p className="mt-1 italic opacity-80">Model read: {result.fields.reasoning}</p>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Document type" required>
            <Select name="document_type_id" value={typeId} onValueChange={setTypeId} required>
              <SelectTrigger><SelectValue placeholder="Choose a type" /></SelectTrigger>
              <SelectContent>
                {documentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="document_type_id" value={typeId} />
          </Field>

          <Field
            label="Expiry date" required
            hint={
              result.fields?.expiry_date
                ? `Model read ${formatDate(result.fields.expiry_date)}`
                : 'Not found on the document - please enter it'
            }
          >
            <Input
              name="expiry_date"
              type="date"
              required
              defaultValue={result.fields?.expiry_date ?? ''}
              className={cn(lowConfidence && 'border-warn ring-1 ring-warn/40')}
            />
          </Field>

          <Field label="Issue date">
            <Input name="issue_date" type="date" defaultValue={result.fields?.issue_date ?? ''} />
          </Field>

          <Field label="Document number">
            <Input name="document_number" defaultValue={result.fields?.document_number ?? ''} />
          </Field>
        </div>

        <div className="space-y-3">
          <Field label="Belongs to">
            <Select value={holderChoice} onValueChange={setHolderChoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_HOLDER}>The company itself</SelectItem>
                <SelectItem value={NEW_HOLDER}>
                  Add new{result.fields?.holder_name ? `: ${result.fields.holder_name}` : ''}
                </SelectItem>
                {holders.map((holder) => (
                  <SelectItem key={holder.id} value={holder.id}>
                    {holder.name}{holder.identifier ? ` · ${holder.identifier}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {holderChoice === NEW_HOLDER && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-3">
              <Field label="Name" required>
                <Input name="new_holder_name" required defaultValue={result.fields?.holder_name ?? ''} />
              </Field>
              <Field label="Type">
                <Select name="new_holder_type" defaultValue="employee">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOLDER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{HOLDER_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Staff or plate number">
                <Input name="new_holder_identifier" placeholder="EMP-014" />
              </Field>
            </div>
          )}

          <Field label="Who chases this renewal">
            <Select name="responsible_user_id" defaultValue={defaultResponsibleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {team.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
        </div>

        <div className="flex items-center gap-2 lg:col-span-2">
          <Button type="submit" disabled={pending || !typeId}>
            {pending && <Loader2 className="animate-spin" />}
            Confirm and save
          </Button>
          <Button type="button" variant="ghost" onClick={discard} disabled={pending}>
            Discard
          </Button>
          {previewUrl && (
            <span className="text-xs text-muted-foreground">
              The scan link expires after 60 seconds.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label, children, required, hint,
}: {
  label: string; children: React.ReactNode; required?: boolean; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </Label>
      {children}
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
