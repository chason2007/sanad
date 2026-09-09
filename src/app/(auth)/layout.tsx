import { Brand } from '@/components/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Brand className="mb-8" />
          {children}
        </div>
      </div>

      {/* The pitch, in the customer's own words. No stock photography. */}
      <aside className="hidden border-l bg-muted/40 lg:flex lg:flex-col lg:justify-center lg:px-12">
        <blockquote className="max-w-md">
          <p className="text-xl font-medium leading-relaxed">
            Every renewal we missed started the same way: it was in the
            spreadsheet, and nobody opened the spreadsheet.
          </p>
          <footer className="mt-4 text-sm text-muted-foreground">
            HR Manager, 40-person contracting firm, Dubai
          </footer>
        </blockquote>
        <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t pt-8 text-sm">
          <div>
            <dt className="text-muted-foreground">Fine for a lapsed visa</dt>
            <dd className="mt-1 font-semibold tabular-nums">AED 100/day</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Trade licence late fee</dt>
            <dd className="mt-1 font-semibold tabular-nums">AED 250/month</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Setup time</dt>
            <dd className="mt-1 font-semibold tabular-nums">15 minutes</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
