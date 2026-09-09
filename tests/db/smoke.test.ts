import { describe, it, expect } from 'vitest';
import { createTestDb } from './harness';

describe('migrations', () => {
  it('apply cleanly to a real Postgres', async () => {
    const db = await createTestDb();
    const res = await db.query<{ c: number }>(
      `select count(*)::int as c from public.document_types where org_id is null`,
    );
    expect(res.rows[0].c).toBeGreaterThan(8);
    await db.close();
  });
});
