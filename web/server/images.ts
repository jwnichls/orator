import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ImageResult {
  provider: "openverse" | "wikimedia";
  id: string;
  title: string;
  thumbUrl: string;
  url: string; // full-size image
  pageUrl?: string;
  creator?: string;
  license?: string;
  licenseUrl?: string;
  width?: number;
  height?: number;
}

const UA = "Orator/0.1 (presentation authoring prototype)";
const SEARCH_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;

async function openverse(q: string): Promise<ImageResult[]> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&mature=false`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Openverse ${res.status}`);
  const data = (await res.json()) as { results: any[] };
  return data.results.map((r) => ({
    provider: "openverse",
    id: r.id,
    title: cleanTitle(r.title),
    thumbUrl: r.thumbnail ?? r.url,
    url: r.url,
    pageUrl: r.foreign_landing_url,
    creator: stripHtml(r.creator),
    license: r.license ? `${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim() : undefined,
    licenseUrl: r.license_url ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
  }));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function stripHtml(s?: string) {
  return (
    s
      ?.replace(/<[^>]*>/g, "")
      .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

/** Human title from provider metadata: no markup, no "File:" namespace, no file extension. */
export function cleanTitle(raw?: string) {
  return stripHtml(raw)?.replace(/^File:/i, "").replace(/\.(jpe?g|png|gif|webp|tiff?|svg)$/i, "").trim() ?? "";
}

async function wikimedia(q: string): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "500",
    origin: "*",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikimedia ${res.status}`);
  const data = (await res.json()) as { query?: { pages: Record<string, any> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  return pages.flatMap((p) => {
    const info = p.imageinfo?.[0];
    if (!info) return [];
    const meta = info.extmetadata ?? {};
    return [
      {
        provider: "wikimedia" as const,
        id: String(p.pageid),
        title: cleanTitle(meta.ObjectName?.value) || cleanTitle(p.title),
        thumbUrl: info.thumburl ?? info.url,
        // Originals can be tens of megapixels; a 1920px rendition (a standard Commons width) is plenty for a screen.
        url: info.thumburl && info.width > 1920 ? info.thumburl.replace(/\/\d+px-/, "/1920px-") : info.url,
        pageUrl: info.descriptionurl,
        creator: stripHtml(meta.Artist?.value),
        license: meta.LicenseShortName?.value,
        licenseUrl: meta.LicenseUrl?.value,
        width: info.width,
        height: info.height,
      },
    ];
  });
}

export async function searchImages(q: string, providers: string[]) {
  const tasks: Promise<ImageResult[]>[] = [];
  if (providers.includes("openverse")) tasks.push(openverse(q));
  if (providers.includes("wikimedia")) tasks.push(wikimedia(q));
  const settled = await Promise.allSettled(tasks);
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [String(s.reason)] : []));
  // Interleave providers so one source doesn't dominate the top of the grid.
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const results: ImageResult[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) results.push(l[i]);
  }
  return { results, errors };
}

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Addresses the image proxy must never reach (loopback, private, link-local/metadata, CGNAT, multicast...).
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 127], // :: and ::1
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

// IPv4-mapped and NAT64 IPv6 forms could smuggle an internal IPv4 address. Kept separate because Node's
// BlockList also matches plain IPv4 addresses against ::ffff:0:0/96, which would block everything.
const blockedV6Only = new BlockList();
blockedV6Only.addSubnet("::ffff:0:0", 96, "ipv6");
blockedV6Only.addSubnet("64:ff9b::", 96, "ipv6");

export function isBlockedAddress(address: string) {
  if (isIP(address) === 6) return blocked.check(address, "ipv6") || blockedV6Only.check(address, "ipv6");
  return blocked.check(address, "ipv4");
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const systemLookup: Lookup = (host) => lookup(host, { all: true, verbatim: true });

/** Throws unless the URL is http(s) and its host resolves only to public addresses. */
export async function assertPublicUrl(raw: string, resolve: Lookup = systemLookup) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL not allowed");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("URL not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("URL not allowed");
  }
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host).catch(() => []);
  if (!addresses.length) throw new Error("Could not resolve host");
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new Error("URL not allowed");
  return u;
}

// Fetch image bytes server-side so the browser can store them (no CORS limits) for offline use.
// Redirects are followed by hand so every hop is checked against the address blocklist.
export async function fetchImageBytes(raw: string, resolve: Lookup = systemLookup) {
  let url = (await assertPublicUrl(raw, resolve)).toString();
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = (await assertPublicUrl(new URL(res.headers.get("location")!, url).toString(), resolve)).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`Not an image (${type})`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Image too large");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("Image too large");
    return { type, buf };
  }
}
