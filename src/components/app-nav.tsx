'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, FileText, Users, Upload, FileBarChart, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid, exact: true },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/holders', label: 'People & assets', icon: Users },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
  { href: '/settings/entities', label: 'Settings', icon: Settings, match: '/settings' },
];

export function AppNav({ needsReviewCount }: { needsReviewCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.match ?? item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
              active
                ? 'bg-secondary font-medium text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.href === '/upload' && needsReviewCount > 0 && (
              <span className="ml-auto rounded-full bg-warn-soft px-1.5 py-0.5 text-2xs font-semibold text-warn-ink">
                {needsReviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
