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
// ponytail: name check only — a public name that resolves to a private address still passes; add Deno.resolveDns +
// private-range check before fetch if hostile tenants become a real risk.

if (import.meta.main) {
  const ok = ["https://hooks.example.com/x", "https://api.partner.in/hatchpro"];
  const bad = ["http://hooks.example.com", "https://127.0.0.1/x", "https://10.0.0.5", "https://[::1]/", "https://localhost/x",
    "https://metadata.google.internal/", "https://intranet/", "https://x.example.com:8443/", "https://u:p@example.com/", "ftp://example.com"];
  for (const u of ok) if (!safeWebhookUrl(u)) throw new Error("should allow " + u);
  for (const u of bad) if (safeWebhookUrl(u)) throw new Error("should block " + u);
  console.log("safeWebhookUrl ok");
}
