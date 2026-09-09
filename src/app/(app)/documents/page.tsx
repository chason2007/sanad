import { requireSession } from '@/lib/auth';
import { fetchDocumentTypes, fetchRegister, fetchTeam } from '@/lib/queries';
import { DocumentsClient } from '@/components/documents-client';
import { canWrite } from '@/lib/types';
import type { RegisterFilters } from '@/lib/register';

export const metadata = { title: 'Documents' };

/**
 * The whole register is loaded once and filtered on the client. At the size
 * this product targets - a 15-100 person firm, so hundreds of documents,
 * not millions - that keeps filtering and sorting instant and avoids a
 * round trip per keystroke. If a customer ever crosses into five figures,
 * this is the screen to paginate.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession();
  const [rows, documentTypes, team] = await Promise.all([
    fetchRegister(),
    fetchDocumentTypes(),
    fetchTeam(),
  ]);

  const single = (key: string) =>
    typeof searchParams[key] === 'string' ? (searchParams[key] as string) : undefined;

  const initialFilters: RegisterFilters = {
    status: single('status'),
    entityId: single('entity'),
    holderType: single('holderType'),
    documentTypeId: single('documentType'),
    responsibleUserId: single('responsible'),
    search: single('q'),
  };

  return (
    <DocumentsClient
      rows={rows}
      entities={session.entities}
      documentTypes={documentTypes}
      team={team}
      canWrite={canWrite(session.profile.role)}
      initialFilters={initialFilters}
    />
  );
}
