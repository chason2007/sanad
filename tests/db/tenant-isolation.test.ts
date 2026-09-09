import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, createAuthUser, asUser, claimsFor, type TestDb } from './harness';

/**
 * Phase 1 acceptance criterion: "Two separate orgs cannot see each other's
 * data by any means, including direct API calls with a forged org_id."
 *
 * These run against a real Postgres with the real migration files, as the
 * real `authenticated` role. Nothing here is mocked.
 */

let db: TestDb;
const A = { user: '', org: '', entity: '', holder: '', doc: '' };
const B = { user: '', org: '', entity: '', holder: '', doc: '' };
let viewerB = '';

async function seedOrg(userId: string, company: string) {
  return asUser(db, userId, {}, async () => {
    const signup = await db.query<{ org_id: string; entity_id: string }>(
      `select * from public.signup_org($1, $2, $3, $4, $5, null)`,
      [company, `Owner of ${company}`, `${company} FZ-LLC`, `TL-${company}`, 'Dubai'],
    );
    const { org_id, entity_id } = signup.rows[0];

    const holder = await db.query<{ id: string }>(
      `insert into public.holders (entity_id, holder_type, name, identifier)
       values ($1, 'employee', $2, 'EMP-001') returning id`,
      [entity_id, `${company} Employee`],
    );

    const doc = await db.query<{ id: string }>(
      `insert into public.documents (entity_id, holder_id, document_type_id, document_number, expiry_date, responsible_user_id)
       select $1, $2, dt.id, $3, current_date + 45, $4
       from public.document_types dt where dt.code = 'employee_visa' and dt.org_id is null
       returning id`,
      [entity_id, holder.rows[0].id, `DOC-${company}`, userId],
    );

    return { org: org_id, entity: entity_id, holder: holder.rows[0].id, doc: doc.rows[0].id };
  });
}

beforeAll(async () => {
  db = await createTestDb();

  A.user = await createAuthUser(db, 'owner-a@acme.test');
  B.user = await createAuthUser(db, 'owner-b@globex.test');
  viewerB = await createAuthUser(db, 'viewer-b@globex.test');

  Object.assign(A, await seedOrg(A.user, 'Acme'));
  Object.assign(B, await seedOrg(B.user, 'Globex'));

  // A viewer inside org B, to prove the read-only role is really read-only.
  await asUser(db, B.user, claimsFor(B.org, 'owner'), async () => {
    await db.query(
      `insert into public.profiles (id, org_id, full_name, email, role)
       values ($1, $2, 'Viewer B', 'viewer-b@globex.test', 'viewer')`,
      [viewerB, B.org],
    );
  });
}, 120000);

afterAll(async () => { await db?.close(); });

describe('tenant isolation: reads', () => {
  it('org A sees exactly one organization - its own', async () => {
    const rows = await asUser(db, A.user, claimsFor(A.org), async () =>
      (await db.query<{ id: string; name: string }>(`select id, name from public.organizations`)).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(A.org);
  });

  it.each([
    ['entities', 'select id from public.entities'],
    ['holders', 'select id from public.holders'],
    ['documents', 'select id from public.documents'],
    ['document_register', 'select id from public.document_register'],
  ])('org A sees no org B rows in %s', async (_label, sql) => {
    const rows = await asUser(db, A.user, claimsFor(A.org), async () =>
      (await db.query<{ id: string }>(sql)).rows.map((r) => r.id),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).not.toContain(B.entity);
    expect(rows).not.toContain(B.holder);
    expect(rows).not.toContain(B.doc);
  });

  it('org A cannot fetch a known org B document by its exact id', async () => {
    const rows = await asUser(db, A.user, claimsFor(A.org), async () =>
      (await db.query(`select * from public.documents where id = $1`, [B.doc])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('the document_register view does not bypass RLS (security_invoker)', async () => {
    const rows = await asUser(db, A.user, claimsFor(A.org), async () =>
      (await db.query(`select * from public.document_register where org_id = $1`, [B.org])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('org A cannot read org B profiles or audit log', async () => {
    const { profiles, audit } = await asUser(db, A.user, claimsFor(A.org), async () => ({
      profiles: (await db.query(`select id from public.profiles where org_id = $1`, [B.org])).rows,
      audit: (await db.query(`select id from public.audit_log where org_id = $1`, [B.org])).rows,
    }));
    expect(profiles).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });
});

describe('tenant isolation: forged input', () => {
  it('a forged org_id in the payload cannot plant a row in org B', async () => {
    await expect(
      asUser(db, A.user, claimsFor(A.org), async () =>
        db.query(
          `insert into public.documents (entity_id, document_type_id, expiry_date)
           select $1, dt.id, current_date + 10
           from public.document_types dt where dt.code = 'trade_licence' and dt.org_id is null`,
          [B.entity], // <- org B's entity, supplied by the attacker
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a forged entity org_id cannot move an entity between tenants', async () => {
    await expect(
      asUser(db, A.user, claimsFor(A.org), async () =>
        db.query(`update public.entities set org_id = $1 where id = $2`, [B.org, A.entity]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('updates aimed at org B rows affect nothing', async () => {
    const affected = await asUser(db, A.user, claimsFor(A.org), async () => {
      const res = await db.query(
        `update public.documents set notes = 'pwned' where id = $1`, [B.doc],
      );
      return res.affectedRows ?? 0;
    });
    expect(affected).toBe(0);

    const notes = await asUser(db, B.user, claimsFor(B.org), async () =>
      (await db.query<{ notes: string | null }>(`select notes from public.documents where id = $1`, [B.doc])).rows[0].notes,
    );
    expect(notes).toBeNull();
  });

  it('deletes aimed at org B rows affect nothing', async () => {
    const affected = await asUser(db, A.user, claimsFor(A.org), async () => {
      const res = await db.query(`delete from public.holders where id = $1`, [B.holder]);
      return res.affectedRows ?? 0;
    });
    expect(affected).toBe(0);
  });

  it('user_metadata cannot be used to claim another org', async () => {
    // user_metadata IS client-writable in Supabase. auth_org_id() must read
    // app_metadata only, or any user could rewrite their own tenancy.
    const rows = await asUser(
      db, A.user,
      { app_metadata: { org_id: A.org }, user_metadata: { org_id: B.org } },
      async () => (await db.query(`select id from public.entities`)).rows.map((r: any) => r.id),
    );
    expect(rows).toEqual([A.entity]);
  });

  it('a missing org claim falls back to profiles, not to open access', async () => {
    const rows = await asUser(db, A.user, {}, async () =>
      (await db.query<{ id: string }>(`select id from public.entities`)).rows.map((r) => r.id),
    );
    expect(rows).toEqual([A.entity]);
  });
});

describe('roles', () => {
  it('a viewer can read the register', async () => {
    const rows = await asUser(db, viewerB, claimsFor(B.org, 'viewer'), async () =>
      (await db.query(`select id from public.document_register`)).rows,
    );
    expect(rows).toHaveLength(1);
  });

  it('a viewer cannot create a document', async () => {
    await expect(
      asUser(db, viewerB, claimsFor(B.org, 'viewer'), async () =>
        db.query(
          `insert into public.documents (entity_id, document_type_id, expiry_date)
           select $1, dt.id, current_date + 10 from public.document_types dt
           where dt.code = 'trade_licence' and dt.org_id is null`,
          [B.entity],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a viewer cannot read storage objects (no file downloads)', async () => {
    await asUser(db, B.user, claimsFor(B.org, 'owner'), async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('documents', $1)`,
        [`${B.org}/${B.entity}/${B.doc}/visa.pdf`],
      );
    });

    const asViewer = await asUser(db, viewerB, claimsFor(B.org, 'viewer'), async () =>
      (await db.query(`select id from storage.objects`)).rows,
    );
    expect(asViewer).toHaveLength(0);

    const asOwner = await asUser(db, B.user, claimsFor(B.org, 'owner'), async () =>
      (await db.query(`select id from storage.objects`)).rows,
    );
    expect(asOwner).toHaveLength(1);
  });

  it('org A cannot read org B storage objects', async () => {
    const rows = await asUser(db, A.user, claimsFor(A.org), async () =>
      (await db.query(`select id from storage.objects`)).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('a viewer cannot promote themselves', async () => {
    await expect(
      asUser(db, viewerB, claimsFor(B.org, 'viewer'), async () =>
        db.query(`update public.profiles set role = 'owner' where id = $1`, [viewerB]),
      ),
    ).rejects.toThrow(/only an owner may change a role/i);
  });

  it('the audit log is append-only', async () => {
    await expect(
      asUser(db, A.user, claimsFor(A.org), async () =>
        db.query(`delete from public.audit_log where org_id = $1`, [A.org]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('a second signup_org call by the same user is rejected', async () => {
    await expect(
      asUser(db, A.user, claimsFor(A.org), async () =>
        db.query(`select * from public.signup_org('Sneaky Ltd', 'A', null, null, null, null)`),
      ),
    ).rejects.toThrow(/already belongs to an organization/i);
  });
});
