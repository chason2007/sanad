import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { fetchHolders, fetchRegister } from '@/lib/queries';
import { RegisterTable } from '@/components/register-table';
import { byExpiryThenName } from '@/lib/register';
import { canWrite, HOLDER_TYPE_LABELS } from '@/lib/types';

export default async function HolderPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const [holders, rows] = await Promise.all([fetchHolders(), fetchRegister()]);

  const holder = holders.find((h) => h.id === params.id);
  if (!holder) notFound();

  // Everything this person or asset holds, in one place. This is the view an
  // HR manager actually wants before a visa run.
  const documents = rows
    .filter((row) => row.holder_id === holder.id)
    .sort(byExpiryThenName);

  const live = documents.filter((d) => d.status !== 'renewed' && d.status !== 'archived');

  return (
    <div className="space-y-5">
      <Link
        href="/holders"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />All people &amp; assets
      </Link>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{holder.name}</h1>
        <p className="text-sm text-muted-foreground">
          {HOLDER_TYPE_LABELS[holder.holder_type]}
          {holder.identifier && ` · ${holder.identifier}`}
          {!holder.active && ' · inactive'}
          {` · ${live.length} live ${live.length === 1 ? 'document' : 'documents'}`}
        </p>
      </div>

      <RegisterTable
        rows={documents}
        showEntity={session.entities.length > 1}
        canWrite={canWrite(session.profile.role)}
        emptyMessage="No documents recorded against this holder yet."
      />
    </div>
  );
}
