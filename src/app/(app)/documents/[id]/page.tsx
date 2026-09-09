import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import {
  fetchAlertsForDocument, fetchDocumentTypes, fetchHolders,
  fetchRegisterRow, fetchRenewalChain, fetchTeam,
} from '@/lib/queries';
import { DocumentDetail } from '@/components/document-detail';
import { canDownloadFiles, canWrite } from '@/lib/types';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const row = await fetchRegisterRow(params.id);
  return { title: row ? row.document_type_label : 'Document' };
}

export default async function DocumentPage({ params }: { params: { id: string } }) {
  const session = await requireSession();

  // RLS returns nothing for another tenant's id, so this 404s rather than
  // confirming the row exists somewhere else.
  const row = await fetchRegisterRow(params.id);
  if (!row) notFound();

  const [chain, alerts, holders, team, documentTypes] = await Promise.all([
    fetchRenewalChain(params.id),
    fetchAlertsForDocument(params.id),
    fetchHolders(),
    fetchTeam(),
    fetchDocumentTypes(),
  ]);

  const documentType = documentTypes.find((t) => t.id === row.document_type_id) ?? null;

  return (
    <DocumentDetail
      row={row}
      documentType={documentType}
      chain={chain}
      alerts={alerts as never[]}
      holders={holders.filter((h) => h.entity_id === row.entity_id)}
      team={team}
      canWrite={canWrite(session.profile.role)}
      canDownload={canDownloadFiles(session.profile.role)}
    />
  );
}
