import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_ROUTES = [
  '/login', '/signup', '/auth/callback', '/auth/confirm',
  // Signed alert-action links. The recipient of a reminder is often not a
  // Sanad user at all, so these authorise with an HMAC token instead of a
  // session - see src/lib/alerts/tokens.ts.
  '/a/',
];

/**
 * Refreshes the Supabase session cookie on every request and keeps
 * unauthenticated traffic out of the app shell.
 *
 * This is a convenience gate, not the security boundary. The real boundary
 * is RLS in Postgres: even if this middleware were bypassed entirely, no
 * query would return another tenant's rows.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => request.cookies.get(name)?.value,
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // A Supabase outage must not 500 the login page. Treat an unreachable
  // auth service as "nobody is signed in" and let the login form render.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    console.error('[middleware] auth lookup failed', err);
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back here after signing in.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, images and the cron/webhook endpoints
    // (which authenticate with their own secrets, not a user session).
    '/((?!_next/static|_next/image|favicon.ico|api/cron|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
