/**
 * Where customer data physically resides.
 *
 * Enterprise buyers and their legal teams ask this in the first security
 * questionnaire, and "somewhere on Supabase" is not an answer. It lives in
 * code rather than a wiki so it stays true: the region is set from the
 * deployed environment, and the export README and the settings screen both
 * read from here, so they cannot drift apart.
 */

export interface Region {
  code: string;
  city: string;
  country: string;
  /** The regime a regulator or buyer will actually care about. */
  regime: string;
}

const REGIONS: Record<string, Region> = {
  'ap-south-1': {
    code: 'ap-south-1', city: 'Mumbai', country: 'India',
    regime: "India's Digital Personal Data Protection Act",
  },
  'eu-central-1': {
    code: 'eu-central-1', city: 'Frankfurt', country: 'Germany',
    regime: 'EU GDPR',
  },
  'eu-west-1': {
    code: 'eu-west-1', city: 'Dublin', country: 'Ireland',
    regime: 'EU GDPR',
  },
  'eu-west-2': {
    code: 'eu-west-2', city: 'London', country: 'United Kingdom',
    regime: 'UK GDPR',
  },
};

const configured = process.env.NEXT_PUBLIC_SUPABASE_REGION || 'eu-central-1';

export const PRIMARY_REGION: Region =
  REGIONS[configured] ?? {
    code: configured, city: 'unknown', country: 'unknown',
    regime: 'not documented - set NEXT_PUBLIC_SUPABASE_REGION',
  };

export const DATA_RESIDENCY = {
  region: PRIMARY_REGION,

  summary:
    `All customer data - database, uploaded scans and backups - is stored in ` +
    `${PRIMARY_REGION.city}, ${PRIMARY_REGION.country} (${PRIMARY_REGION.code}). ` +
    `It is subject to ${PRIMARY_REGION.regime}.`,

  /**
   * The honest list. Every one of these is a place data crosses a border,
   * and a buyer is entitled to all of them - not just the database region.
   */
  subprocessors: [
    {
      name: 'Supabase (AWS)',
      purpose: 'Database, authentication and file storage',
      location: `${PRIMARY_REGION.city}, ${PRIMARY_REGION.country}`,
      dataSeen: 'All customer data, including uploaded scans',
    },
    {
      name: 'Vercel',
      purpose: 'Application hosting',
      location: 'Global edge; server functions pinned to the primary region',
      dataSeen: 'Data in transit during a request. Nothing is stored at rest.',
    },
    {
      name: 'Anthropic',
      purpose: 'Reading expiry dates off uploaded documents',
      location: 'United States',
      dataSeen:
        'The document image and the fields read from it, at the moment of upload. ' +
        'Not used for training and not retained beyond the request.',
    },
    {
      name: 'Resend',
      purpose: 'Reminder and report emails',
      location: 'United States',
      dataSeen:
        'Recipient name and email, document type, holder name and expiry date. ' +
        'No scans are ever attached to a reminder.',
    },
    {
      name: 'Stripe',
      purpose: 'Payments',
      location: 'United States and Ireland',
      dataSeen: 'Billing contact and payment details. No document data.',
    },
  ],

  /** Stated plainly because it is the question behind the question. */
  notes: [
    'Uploaded scans are held in a private bucket. There is no public URL, and the bucket is prevented from being made public by a database trigger.',
    'Files are served only through signed links that expire after 60 seconds, and every download is written to the audit log.',
    'Superseded scans are purged automatically on the retention schedule set by the organisation.',
    'An organisation owner can export everything or delete the organisation outright at any time, without contacting support.',
  ],
} as const;
