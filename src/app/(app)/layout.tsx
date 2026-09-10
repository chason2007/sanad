import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/brand';
import { AppNav } from '@/components/app-nav';
import { UserMenu } from '@/components/user-menu';
import { dubaiToday, formatDate } from '@/lib/dates';
import { TrialBanner } from '@/components/trial-banner';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = createClient();

  const [{ count: needsReviewCount }, { count: documentCount }] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('needs_review', true),
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .not('status', 'in', '("archived")'),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex h-12 items-center border-b px-3">
          <Link href="/"><Brand /></Link>
        </div>

        <div className="border-b px-3 py-2.5">
          <p className="truncate text-sm font-medium">{session.organization.name}</p>
          <p className="text-2xs text-muted-foreground">
            {session.entities.length} {session.entities.length === 1 ? 'entity' : 'entities'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AppNav needsReviewCount={needsReviewCount ?? 0} />
        </div>

        <div className="border-t p-1.5">
          <UserMenu
            fullName={session.profile.full_name}
            email={session.profile.email}
            role={session.profile.role}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur">
          <Link href="/" className="md:hidden"><Brand showWord={false} /></Link>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Asia/Dubai</span>
            <span className="tabular-nums">{formatDate(dubaiToday())}</span>
          </div>
        </header>

        <TrialBanner
          organization={session.organization}
          isOwner={session.profile.role === 'owner'}
          documentCount={documentCount ?? 0}
        />

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
