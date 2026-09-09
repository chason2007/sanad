'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings/entities', label: 'Companies' },
  { href: '/settings/users', label: 'People' },
  { href: '/settings/alerts', label: 'Reminders' },
  { href: '/settings/billing', label: 'Billing', ownerOnly: true },
];

export function SettingsNav({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b">
      {TABS.filter((tab) => !tab.ownerOnly || isOwner).map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
