'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { createEntity, updateEntity } from '@/app/actions/settings';
import type { Entity, Organization, Profile } from '@/lib/types';

const EMIRATES = [
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah',
];

export function EntitiesSettings({
  entities, team, organization, canWrite,
}: {
  entities: Entity[];
  team: Profile[];
  organization: Organization;
  canWrite: boolean;
}) {
  const atLimit = entities.length >= organization.entity_limit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Companies</h2>
          <p className="text-xs text-muted-foreground">
            {entities.length} of {organization.entity_limit} on the{' '}
            {organization.plan.replace('_', '-')} plan.
          </p>
        </div>
        {canWrite && <AddEntity disabled={atLimit} limit={organization.entity_limit} />}
      </div>

      {entities.map((entity) => (
        <EntityCard key={entity.id} entity={entity} team={team} canWrite={canWrite} />
      ))}
    </div>
  );
}

function EntityCard({
  entity, team, canWrite,
}: { entity: Entity; team: Profile[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('entity_id', entity.id);
    startTransition(async () => {
      const res = await updateEntity(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Saved.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{entity.name}</span>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Company name</Label>
          <Input name="name" required defaultValue={entity.name} disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label>Trade licence number</Label>
          <Input
            name="trade_licence_number"
            defaultValue={entity.trade_licence_number ?? ''}
            disabled={!canWrite}
          />
        </div>
        <div className="space-y-1">
          <Label>Emirate</Label>
          <Select name="emirate" defaultValue={entity.emirate ?? ''} disabled={!canWrite}>
            <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {EMIRATES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Escalation contact</Label>
          <Select
            name="escalation_user_id"
            defaultValue={entity.escalation_user_id ?? ''}
            disabled={!canWrite}
          >
            <SelectTrigger><SelectValue placeholder="Nobody" /></SelectTrigger>
            <SelectContent>
              {team.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-2xs text-muted-foreground">
            Notified when a reminder goes unacknowledged.
          </p>
        </div>
      </div>

      {canWrite && (
        <div className="border-t px-4 py-2.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Save
          </Button>
        </div>
      )}
    </form>
  );
}

function AddEntity({ disabled, limit }: { disabled: boolean; limit: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await createEntity(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not add.'); return; }
      toast.success('Company added.');
      setOpen(false);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <Button size="sm" variant="outline" disabled title={`Your plan covers ${limit}.`}>
        <Plus />Add company
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus />Add company</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>
            A separate legal entity with its own trade licence.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="entity-name">Company name</Label>
            <Input id="entity-name" name="name" required autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entity-licence">Trade licence number</Label>
            <Input id="entity-licence" name="trade_licence_number" />
          </div>
          <div className="space-y-1">
            <Label>Emirate</Label>
            <Select name="emirate">
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {EMIRATES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
