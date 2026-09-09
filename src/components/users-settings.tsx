'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, UserPlus, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { inviteUser, removeUser, updateOwnProfile, updateUserRole } from '@/app/actions/settings';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Profile, type UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['owner', 'admin', 'viewer'];

export function UsersSettings({
  team, currentUser, isOwner,
}: { team: Profile[]; currentUser: Profile; isOwner: boolean }) {
  return (
    <div className="space-y-6">
      <YourProfile profile={currentUser} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Your team</h2>
            <p className="text-xs text-muted-foreground">
              {team.length} {team.length === 1 ? 'person' : 'people'} with access.
            </p>
          </div>
          {isOwner && <InviteUser />}
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b bg-muted/50 text-2xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">Email</th>
                <th className="px-2 py-2 text-left font-medium">Notified by</th>
                <th className="px-2 py-2 text-left font-medium">Role</th>
                {isOwner && <th className="w-10 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {team.map((person) => (
                <TeamRow
                  key={person.id}
                  person={person}
                  isOwner={isOwner}
                  isSelf={person.id === currentUser.id}
                />
              ))}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 text-xs sm:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role} className="rounded-md border px-3 py-2">
              <dt className="font-medium">{ROLE_LABELS[role]}</dt>
              <dd className="mt-0.5 text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function TeamRow({
  person, isOwner, isSelf,
}: { person: Profile; isOwner: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeRole(role: string) {
    startTransition(async () => {
      const res = await updateUserRole(person.id, role as UserRole);
      if (!res.ok) { toast.error(res.error ?? 'Could not change the role.'); return; }
      toast.success(`${person.full_name || person.email} is now ${ROLE_LABELS[role as UserRole]}.`);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeUser(person.id);
      if (!res.ok) { toast.error(res.error ?? 'Could not remove.'); return; }
      toast.success('Removed.');
      router.refresh();
    });
  }

  const channels = [
    person.notification_email && 'Email',
    person.notification_whatsapp && 'WhatsApp',
  ].filter(Boolean);

  return (
    <tr>
      <td className="px-3 py-1.5">
        {person.full_name || <span className="text-muted-foreground">Not set</span>}
        {isSelf && <span className="ml-1.5 text-2xs text-muted-foreground">(you)</span>}
      </td>
      <td className="truncate px-2 py-1.5 text-muted-foreground">{person.email}</td>
      <td className="px-2 py-1.5">
        {channels.length ? (
          <span className="text-2xs text-muted-foreground">{channels.join(' + ')}</span>
        ) : (
          <Badge variant="soon">Nothing</Badge>
        )}
      </td>
      <td className="px-2 py-1.5">
        {isOwner && !isSelf ? (
          <Select value={person.role} onValueChange={changeRole} disabled={pending}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline">{ROLE_LABELS[person.role]}</Badge>
        )}
      </td>
      {isOwner && (
        <td className="px-3 py-1.5">
          {!isSelf && (
            <Button variant="ghost" size="icon" onClick={remove} disabled={pending} aria-label="Remove">
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function YourProfile({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await updateOwnProfile(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Saved.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Your profile</h2>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="full_name">Your name</Label>
          <Input id="full_name" name="full_name" defaultValue={profile.full_name} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone_e164">Mobile (for WhatsApp)</Label>
          <Input
            id="phone_e164"
            name="phone_e164"
            defaultValue={profile.phone_e164 ?? ''}
            placeholder="+971501234567"
          />
          <p className="text-2xs text-muted-foreground">
            International format, starting with +.
          </p>
        </div>
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Send my reminders by
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" name="notification_email"
              defaultChecked={profile.notification_email}
              className="h-4 w-4 rounded border-input"
            />
            Email
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" name="notification_whatsapp"
              defaultChecked={profile.notification_whatsapp}
              className="h-4 w-4 rounded border-input"
            />
            WhatsApp
          </label>
        </fieldset>
      </div>
      <div className="border-t px-4 py-2.5">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}Save
        </Button>
      </div>
    </form>
  );
}

function InviteUser() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await inviteUser(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not invite.'); return; }
      toast.success('Invitation sent.');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus />Invite someone</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a colleague</DialogTitle>
          <DialogDescription>
            They get an email with a link to set their password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Work email</Label>
            <Input id="invite-email" name="email" type="email" required autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-name">Their name</Label>
            <Input id="invite-name" name="full_name" />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select name="role" defaultValue="admin">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]} - {ROLE_DESCRIPTIONS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
