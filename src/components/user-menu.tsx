'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronsUpDown, LogOut, User, CreditCard } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS, type UserRole } from '@/lib/types';

export function UserMenu({
  fullName, email, role,
}: { fullName: string; email: string; role: UserRole }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const initials = (fullName || email)
    .split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-2xs font-semibold">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-tight">{fullName || email}</span>
          <span className="block truncate text-2xs text-muted-foreground">{ROLE_LABELS[role]}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/users"><User className="h-4 w-4" />Your profile</Link>
        </DropdownMenuItem>
        {role === 'owner' && (
          <DropdownMenuItem asChild>
            <Link href="/settings/billing"><CreditCard className="h-4 w-4" />Billing</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="h-4 w-4" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
