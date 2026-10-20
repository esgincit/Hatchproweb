import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { claimsFromUser } from '@/lib/auth/claims';
import { redirectFor } from '@/lib/auth/route-guard';

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  // Server actions POST to the current page; redirecting them breaks the call. Each action checks auth itself.
  if (request.headers.has('next-action')) return response;
  const to = redirectFor(request.nextUrl.pathname, user ? claimsFromUser(user) : null);
  if (!to) return response;
  const url = request.nextUrl.clone();
  const [path, query] = to.split('?');
  url.pathname = path;
  url.search = query ? '?' + query : '';
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // keep refreshed session
  return redirect;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|glb|ktx2|hdr|webmanifest)$).*)'],
};
