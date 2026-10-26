import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { claimsFromUser } from '@/lib/auth/claims';
import { redirectFor } from '@/lib/auth/route-guard';

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const to = redirectFor(request.nextUrl.pathname, user ? claimsFromUser(user) : null);
  if (!to) return response;
  // Server actions POST to whatever page is open (e.g. /login right after OTP) and are reachable from any page
  // by id, so the page guard can't protect them — each action authorises itself. Don't redirect a signed-in
  // user's action call (that breaks it); refuse anonymous ones. Page loads (GET) are always guarded.
  if (request.method === 'POST' && request.headers.has('next-action')) return user ? response : new NextResponse(null, { status: 401 });
  const url = request.nextUrl.clone();
  const [path, query] = to.split('?');
  url.pathname = path;
  url.search = query ? '?' + query : '';
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // keep refreshed session
  return redirect;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw\.js|.*\.(?:svg|png|jpg|jpeg|gif|webp|glb|ktx2|hdr|webmanifest)$).*)'],
};
