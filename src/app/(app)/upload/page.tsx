import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { fetchDocumentTypes, fetchHolders, fetchTeam } from '@/lib/queries';
import { UploadClient } from '@/components/upload-client';
import { canWrite } from '@/lib/types';

export const metadata = { title: 'Upload' };

export default async function UploadPage() {
  const session = await requireSession();

  if (!canWrite(session.profile.role)) {
    redirect('/documents');
  }

  const [documentTypes, holders, team] = await Promise.all([
    fetchDocumentTypes(),
    fetchHolders(),
    fetchTeam(),
  ]);

  return (
    <UploadClient
      entities={session.entities}
      documentTypes={documentTypes}
      holders={holders}
      team={team}
      defaultResponsibleId={session.userId}
    />
  );
}
