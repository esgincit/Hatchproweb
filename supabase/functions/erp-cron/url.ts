/** Tenant-supplied webhook URL: https on the default port, a public host name (no IP literals, no internal names). */
export function safeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw), h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
    if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;      // IPv4 / IPv6 literals
    if (h === "localhost" || !h.includes(".") || /\.(local|internal|localhost|lan|home|corp|arpa)$/.test(h)) return false;
    return true;
  } catch { return false; }
}

/** Private, loopback, link-local (incl. cloud metadata 169.254.x), CGNAT, multicast/reserved, and IPv6 equivalents. */
export function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    // allow-list: only global unicast 2000::/3, minus ranges that embed IPv4 (6to4 2002::/16, NAT64 64:ff9b::/96 is outside 2000::/3 anyway)
    return !/^[23][0-9a-f]{0,3}:/.test(v) || v.startsWith("2002:") || v.startsWith("2001:db8:") || /^2001:0{0,3}:/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
}

/** Every A/AAAA record must be public; a failed lookup blocks (fail closed). */
export async function resolvesPublic(host: string): Promise<boolean> {
  try {
    const recs = [
      ...await Deno.resolveDns(host, "A").catch(() => [] as string[]),
      ...await Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ];
    return recs.length > 0 && !recs.some(privateIp);
  } catch { return false; }
}
// ponytail: resolve-then-fetch still leaves a DNS-rebinding window (the fetch re-resolves); route webhooks through an
// egress proxy that enforces the same ranges if tenants with hostile intent become a real risk.

if (import.meta.main) {
  const ok = ["https://hooks.example.com/x", "https://api.partner.in/hatchpro"];
  const bad = ["http://hooks.example.com", "https://127.0.0.1/x", "https://10.0.0.5", "https://[::1]/", "https://localhost/x",
    "https://metadata.google.internal/", "https://intranet/", "https://x.example.com:8443/", "https://u:p@example.com/", "ftp://example.com"];
  for (const u of ok) if (!safeWebhookUrl(u)) throw new Error("should allow " + u);
  for (const u of bad) if (safeWebhookUrl(u)) throw new Error("should block " + u);
  for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1",
                    "::ffff:10.0.0.1", "::a00:1", "64:ff9b::a00:1", "2002:a00:1::1", "2001:db8::1", "2001::1"])
    if (!privateIp(ip)) throw new Error("should be private " + ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "172.32.0.1"]) if (privateIp(ip)) throw new Error("should be public " + ip);
  console.log("url guard ok");
}
