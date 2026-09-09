import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fetchRegister } from '@/lib/queries';
import { buildComplianceReport } from '@/lib/reports/compliance-pdf';
import { recordAudit } from '@/lib/audit';
import { dubaiToday } from '@/lib/dates';

export const maxDuration = 60;

/** GET /api/reports - the monthly compliance PDF, generated on demand. */
export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const entityId = request.nextUrl.searchParams.get('entity');
  const rows = await fetchRegister();

  const pdf = await buildComplianceReport({
    organizationName: session.organization.name,
    rows,
    entityFilter: entityId,
  });

  await recordAudit(createClient(), {
    orgId: session.organization.id,
    actorUserId: session.userId,
    action: 'report.generated',
    metadata: { entity_id: entityId, document_count: rows.length },
  });

  const filename = `sanad-compliance-${dubaiToday()}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
