import { NextRequest, NextResponse } from 'next/server';
import { lookup as dnsLookupCb } from 'node:dns';
import { readCappedRequestText } from '@/lib/request-body';
import { promisify } from 'node:util';
import { rateLimit, getClientIP, getIpBucket, getRedisClient, getRedisStatus } from '@/lib/rate-limit';
import { parseAltchaAuthHeader, verifySolution } from '@/lib/altcha';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import {
  SCAN_RATE_LIMIT,
  SCAN_RATE_WINDOW_MS,
  MAX_URL_LENGTH as TUNING_MAX_URL_LENGTH,
  MAX_BODY_SIZE as TUNING_MAX_BODY_SIZE,
  MAX_COOKIES as TUNING_MAX_COOKIES,
  MAX_SCRIPT_MATCHES as TUNING_MAX_SCRIPT_MATCHES,
  MAX_THIRD_PARTY_DOMAINS as TUNING_MAX_THIRD_PARTY_DOMAINS,
  FETCH_TIMEOUT_MS,
  MAX_IN_FLIGHT_SCANS,
  MAX_IN_FLIGHT_PER_BUCKET,
  BLOCKED_TARGET_HOSTS,
} from '@/lib/tuning';

// Tracker patterns, cookie classifier, SSRF guard, capped reader and the
// analysis itself live in lib/scanner.ts — shared with the offline Site
// Privacy Report Card batch, so both find the same cookies and trackers.
// Only detection is shared: the tool scores and grades a result with its own
// rules (CookieAnalyzerTool), the report cards with lib/site-grade, so the
// two can give the same site different grades. Validation, fetch policy and
// error handling stay here.
import { isBlockedHostname, readCappedText, analyzeScan } from '@/lib/scanner';
import { isPublicUnicastAddress } from '@/lib/net-address';

/** Resolve a hostname to every address it points at, so the SSRF check can judge them. */
const dnsLookup = promisify(dnsLookupCb);

// Input length limits — sourced from lib/tuning.ts so they can be tweaked
// via the service environment without a rebuild. See API-ON-DROPLET.md for panic-mode
// values to set during an active incident.
const MAX_URL_LENGTH = TUNING_MAX_URL_LENGTH;
const MAX_BODY_SIZE = TUNING_MAX_BODY_SIZE;

// Cap on the REQUEST body we accept, as distinct from MAX_BODY_SIZE above,
// which caps the scanned page we fetch. The only thing a caller sends is
// { "url": "…" }, so the URL cap plus a kilobyte of slack for the JSON
// wrapper, whitespace and multi-byte characters is already generous. It
// tracks MAX_URL_LENGTH so the env knob keeps moving both together.
const MAX_REQUEST_BODY = MAX_URL_LENGTH + 1024;
const MAX_COOKIES = TUNING_MAX_COOKIES;
const MAX_SCRIPT_MATCHES = TUNING_MAX_SCRIPT_MATCHES;
const MAX_THIRD_PARTY_DOMAINS = TUNING_MAX_THIRD_PARTY_DOMAINS;

// Origin allowlist + CORS helpers come from lib/origin.ts (shared with /challenge).
// Configure via ALLOWED_ORIGINS env var.

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(origin, request.headers.get('host')) });
}

// Rate limit — values from lib/tuning.ts. Defaults: 10 reqs per 60s per IP.
const RATE_LIMIT_CONFIG = { limit: SCAN_RATE_LIMIT, windowMs: SCAN_RATE_WINDOW_MS };

// Scans running right now, process-wide. The per-IP limiter caps one visitor;
// this caps everyone at once, which is the shape a botnet or a viral link
// actually takes. One process serves this app (systemd ib-api), so a plain
// module-level counter is the whole mechanism — no shared store needed.
let inFlightScans = 0;

/**
 * Scans in flight per rate-limit bucket, so one network cannot hold every slot.
 *
 * Measured on 2026-09-21: a typical scan takes 790ms, so 20 global slots give
 * about 25 scans/sec. But FETCH_TIMEOUT_MS is 5s, and a scan aimed at a server
 * the caller controls can stall for all of it. Holding all 20 slots therefore
 * needs only 4 new scans/sec — roughly 12% of one core in proof-of-work — and
 * while they are held, throughput for everyone else drops to 4 scans/sec.
 *
 * The per-IP rate limit was the only thing standing in the way, and at 10/min
 * per /24 it takes about 24 distinct ranges to beat. A botnet or a single cloud
 * account has that.
 *
 * A per-bucket ceiling changes the arithmetic: one range can hold at most
 * MAX_IN_FLIGHT_PER_BUCKET slots, so denying the whole service needs
 * MAX_IN_FLIGHT_SCANS / MAX_IN_FLIGHT_PER_BUCKET distinct ranges AND enough
 * rate-limit budget in each. It does not make it impossible — nothing here
 * does — it raises the price and keeps one noisy network from crowding out
 * everyone else, which is the common case and not always malicious.
 *
 * The map is pruned to zero entries on release: a Map keyed on caller-supplied
 * network would otherwise be its own slow memory leak.
 */
const inFlightByBucket = new Map<string, number>();

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const cors = corsHeadersFor(origin, host);

  // Strict origin check — reject requests from origins not in the allowlist.
  // This is one of three layers (origin check, POW challenge, rate limit).
  // Note: Origin is set by the browser and cannot be spoofed from page JS, but
  // CAN be spoofed by curl/scripts. The POW below is what actually defends
  // against scripted abuse.
  if (!isOriginAllowed(origin, host)) {
    return NextResponse.json(
      { error: 'Origin not allowed.' },
      { status: 403, headers: cors }
    );
  }

  // Rate limit by /24 IPv4 (or /64 IPv6) network bucket, not exact IP.
  // Why: VPN/CGN users rotate egress IPs per connection. Exact-IP limiting
  // gives them effectively unlimited requests. /24 bucketing catches the
  // common case (same VPN exit pool, same /24) while still scoping abuse
  // narrowly enough that legit users on a shared NAT aren't unfairly grouped
  // with the rest of the internet.
  const clientIP = getClientIP(request.headers);
  const bucket = getIpBucket(clientIP);
  const rl = await rateLimit(bucket, RATE_LIMIT_CONFIG);
  const allHeaders: Record<string, string> = { ...cors, ...rl.headers };

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: allHeaders }
    );
  }

  // Altcha proof-of-work check. The client must have called /challenge, solved
  // the SHA-256 puzzle, and put the solution in the Authorization header.
  // This is what makes scripted abuse expensive — every call costs ~100ms of CPU.
  const solution = parseAltchaAuthHeader(request.headers.get('authorization'));
  const altchaResult = verifySolution(solution);
  if (!altchaResult.valid) {
    return NextResponse.json(
      {
        error:
          'Missing or invalid proof-of-work token. Call /challenge first, solve it, and send the solution as the Authorization header.',
        reason: altchaResult.reason,
      },
      { status: 401, headers: allHeaders }
    );
  }
  // Single use: a solved token buys exactly one scan when Redis is configured
  // (SET NX on the signature for the token's remaining lifetime). Without
  // Redis the 90 s TTL + rate limit remain the only replay bound.
  const redis = getRedisClient();
  if (solution && !redis && getRedisStatus() === 'backoff') {
    // Redis is CONFIGURED but currently unreachable. Fail closed.
    //
    // This is the path the 2026-09-18 fix missed, and it is the likelier of
    // the two by far. getRedisClient() does not throw when Redis is sick — it
    // RETURNS NULL, for CLIENT_RETRY_DELAY_MS (10s) after any error. The guard
    // was `if (redis && solution)`, so a null client skipped the whole
    // single-use claim: no error, no 503, scan served. One induced Redis blip
    // therefore bought a ten-second window in which a single solved
    // proof-of-work could be replayed without limit, which is exactly the
    // attacker-removable control the try/catch below was added to prevent.
    // Found by the security suite's adversarial pass, three reviewers
    // independently, after this was reported as closed.
    //
    // 'disabled' (REDIS_URL unset) deliberately still falls through: that is
    // local dev and the documented degradation, not a production failure.
    return NextResponse.json(
      { error: 'Scanning is briefly unavailable. Please try again in a moment.', reason: 'replay-store-unavailable' },
      { status: 503, headers: { ...allHeaders, 'Retry-After': '5' } },
    );
  }
  if (redis && solution) {
    let fresh: string | null;
    try {
      fresh = await redis.set(`pow:${solution.signature}`, '1', 'EX', 120, 'NX');
    } catch {
      // Fail CLOSED. This used to swallow the error and carry on, which made
      // the replay check an attacker-removable control: whoever can make Redis
      // stop answering — including by flooding it — also switches off
      // single-use, and one solved proof-of-work then buys unlimited scans for
      // its whole 90 s life. Redis is on localhost; if it is down the tool is
      // degraded anyway, so refusing is honest rather than costly.
      return NextResponse.json(
        { error: 'Scanning is briefly unavailable. Please try again in a moment.', reason: 'replay-store-unavailable' },
        { status: 503, headers: { ...allHeaders, 'Retry-After': '5' } },
      );
    }
    if (fresh === null) {
      return NextResponse.json({ error: 'This proof-of-work token was already used. Request a new challenge.', reason: 'replayed' }, { status: 401, headers: allHeaders });
    }
  }

  try {
    // Bound the body BEFORE buffering it. The comment that used to sit here
    // spotted that Apache's cap cannot see a chunked request, then concluded
    // "the post-read check below is the one that binds" — which was the wrong
    // conclusion from the right observation. A post-read check binds what is
    // ACCEPTED; the memory is already spent by the time it runs. Reaching this
    // line costs a valid proof-of-work (~27ms), so it was the least exposed of
    // the four, but it read without limit exactly as the others did.
    // lib/request-body.ts has the measurement.
    const capped = await readCappedRequestText(request, MAX_REQUEST_BODY);
    if (!capped.ok) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413, headers: allHeaders });
    }
    const raw = capped.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Was a 500 via the outer catch, which logged and reported an internal
      // error for what is plainly a bad request.
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers: allHeaders });
    }
    const url = (parsed as { url?: unknown } | null)?.url;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400, headers: allHeaders });
    }

    // Input length check
    if (url.length > MAX_URL_LENGTH) {
      return NextResponse.json({ error: 'URL is too long (max 2048 characters)' }, { status: 400, headers: allHeaders });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      /**
       * Reject a foreign scheme BEFORE the convenience rewrite, not after.
       *
       * The rewrite exists so a visitor can type "example.com". It used to test
       * the raw string with startsWith on the four letters h-t-t-p and prepend
       * a scheme otherwise, which does something surprising to a string that
       * already HAS a scheme:
       *
       *   file:///etc/passwd   ->  https://file:///etc/passwd   -> hostname "file"
       *   gopher://x/1         ->  https://gopher://x/1         -> hostname "gopher"
       *   dict://x:11211/      ->  https://dict://x:11211/      -> hostname "dict"
       *
       * The protocol allowlist below then passes, because the protocol really is
       * https: — and a SINGLE-LABEL hostname goes to the resolver. On a host with
       * a DNS search suffix that is not nothing, "file" can resolve to
       * file.<search-domain>, an internal machine. This droplet has `search .`
       * so it NXDOMAINs today, but a corporate host is exactly where a search
       * suffix exists, and this code is being considered for one.
       *
       * Also note `startsWith('http')` matched "httpfoo://" and "https-evil.com".
       */
      const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
      if (scheme && !/^https?$/i.test(scheme[1])) {
        return NextResponse.json(
          { error: 'Only HTTP/HTTPS URLs are supported' },
          { status: 400, headers: allHeaders },
        );
      }
      parsedUrl = new URL(scheme ? url.trim() : `https://${url.trim()}`);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400, headers: allHeaders });
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400, headers: allHeaders });
    }

    // SSRF Protection: block private/internal networks, plus any host named in
    // BLOCKED_TARGET_HOSTS (by default this droplet itself — see lib/tuning.ts).
    const hostKey = parsedUrl.hostname.toLowerCase().replace(/\.+$/, '');
    // A name with no dot is not a public website. {"url":"intranet"} becomes
    // https://intranet by the convenience rewrite above and goes to dns.lookup
    // as typed, where the host's search suffix decides what it means — on a
    // company box that is intranet.corp.example. The scheme fix closed the
    // path by which file:/gopher: BECAME a single label; this closes the
    // direct one. Bracketed IPv6 literals have no dot and are judged by
    // address below, so they pass here.
    if (!hostKey.includes('.') && !hostKey.startsWith('[')) {
      return NextResponse.json(
        { error: 'Enter a full website address, like example.com.' },
        { status: 400, headers: allHeaders }
      );
    }
    if (isBlockedHostname(parsedUrl.hostname) || BLOCKED_TARGET_HOSTS.has(hostKey)) {
      return NextResponse.json(
        { error: 'Cannot scan private IP addresses, localhost, or internal networks.' },
        { status: 400, headers: allHeaders }
      );
    }

    // Block non-standard ports commonly used for internal services
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);
    if (port !== 80 && port !== 443 && port !== 8080 && port !== 8443) {
      return NextResponse.json(
        { error: 'Only standard web ports (80, 443, 8080, 8443) are supported.' },
        { status: 400, headers: allHeaders }
      );
    }

    // The hostname checks above are string comparisons, so a name that merely
    // RESOLVES somewhere private walks straight past them: 169-254-169-254.nip.io
    // reaches the cloud metadata service, 127-0-0-1.nip.io reaches this droplet's
    // own localhost, and 2130706433 / 0x7f.0.0.1 are the same address written in
    // decimal and hex. Verified against the real check on 2026-09-18; all four
    // returned ALLOWED. The port allowlist keeps Redis and MySQL out of reach,
    // but metadata and the co-hosted WordPress both answer on port 80.
    //
    // So resolve the name first and judge the ADDRESSES, not the text. A public
    // site that resolves into private space is misconfigured or hostile; there
    // is no legitimate scan target behind this check.
    //
    // The addresses are judged by an ALLOWLIST — isPublicUnicastAddress, which
    // refuses anything that is not canonical public unicast — and no longer by
    // isBlockedHostname, which refuses only what it recognises and therefore
    // allowed four different bypasses in a week. The difference is what
    // happens to a form nobody anticipated: the denylist fetched it.
    //
    // A concrete one, found 2026-09-21: `https://[::127.0.0.1]/` is loopback,
    // and isBlockedHostname says allowed. It is not exploitable today only
    // because new URL() rewrites it to `[::7f00:1]` and the BRACKETED string
    // is what goes to dns.lookup, which then fails to resolve. The control
    // that actually stopped it was a bracket. lib/net-address.ts refuses the
    // address on its merits instead.
    try {
      const resolved = await dnsLookup(parsedUrl.hostname, { all: true });
      const blocked = resolved.filter(
        (r) => !isPublicUnicastAddress(r.address) || BLOCKED_TARGET_HOSTS.has(r.address.toLowerCase()),
      );
      if (blocked.length) {
        return NextResponse.json(
          { error: 'Cannot scan private IP addresses, localhost, or internal networks.' },
          { status: 400, headers: allHeaders }
        );
      }
      if (!resolved.length) {
        return NextResponse.json(
          { error: 'Failed to reach this URL. The site may be down or blocking requests.' },
          { status: 502, headers: allHeaders }
        );
      }
    } catch {
      // A name that does not resolve cannot be scanned either way.
      return NextResponse.json(
        { error: 'Failed to reach this URL. The site may be down or blocking requests.' },
        { status: 502, headers: allHeaders }
      );
    }

    const targetUrl = parsedUrl.href;

    // Global concurrency ceiling. Everything above is cheap string work; from
    // here on a request owns a socket and a buffer, so this is the point worth
    // refusing at. Checked and claimed in the same synchronous step — there is
    // no await between them, so the count cannot be raced past the cap.
    const bucketInFlight = inFlightByBucket.get(bucket) ?? 0;
    if (bucketInFlight >= MAX_IN_FLIGHT_PER_BUCKET) {
      return NextResponse.json(
        { error: 'Too many scans running from your network right now. Please try again in a moment.' },
        { status: 503, headers: { ...allHeaders, 'Retry-After': '5' } },
      );
    }
    if (inFlightScans >= MAX_IN_FLIGHT_SCANS) {
      return NextResponse.json(
        { error: 'Too many scans running right now. Please try again in a moment.' },
        { status: 503, headers: { ...allHeaders, 'Retry-After': '5' } },
      );
    }
    inFlightScans++;
    inFlightByBucket.set(bucket, bucketInFlight + 1);

    try {
      // One deadline covering the whole exchange, headers AND body.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const timedOut = () => controller.signal.aborted;
      const seconds = Math.round(FETCH_TIMEOUT_MS / 1000);

      try {
        let response: Response;
        try {
          response = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'manual',  // Don't auto-follow redirects (SSRF prevention)
          });
        } catch (err) {
          const message = err instanceof Error && err.name === 'AbortError'
            ? `Request timed out (${seconds}s). The site may be slow or blocking automated requests.`
            : 'Failed to reach this URL. The site may be down or blocking requests.';
          return NextResponse.json({ error: message }, { status: 502, headers: allHeaders });
        }

        // Reject redirect responses — with redirect:'manual' the body is empty/opaque,
        // and silently "scanning" an unfollowed redirect would give misleading results.
        // The Location header could also target an internal host we already blocked.
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location') || '';
          return NextResponse.json(
            {
              error: `This URL redirects (HTTP ${response.status}). Please scan the final destination directly.`,
              redirectTo: location.slice(0, 500) || null,
            },
            { status: 400, headers: allHeaders }
          );
        }

        // Read HTML body for script analysis — capped to MAX_BODY_SIZE to prevent
        // memory exhaustion from malicious or huge target pages.
        //
        // The timeout is still armed here, deliberately. It used to be cleared
        // the moment the headers landed, which left the body read unbounded in
        // time: a target that answers instantly and then dribbles bytes forever
        // held a scan slot, a socket and an Apache worker indefinitely, and the
        // byte cap never fired because the bytes never arrived. Aborting the
        // controller also errors this stream, so the deadline now covers the
        // slow-body case that the cap alone cannot.
        let html: string;
        try {
          html = await readCappedText(response, MAX_BODY_SIZE);
        } catch (err) {
          const message = timedOut() || (err instanceof Error && err.name === 'AbortError')
            ? `Request timed out (${seconds}s). The site started responding but never finished sending the page.`
            : 'Failed to read this page. The site may have closed the connection early.';
          return NextResponse.json({ error: message }, { status: 502, headers: allHeaders });
        }

        const result = analyzeScan(targetUrl, parsedUrl, response, html, {
          maxCookies: MAX_COOKIES,
          maxScriptMatches: MAX_SCRIPT_MATCHES,
          maxThirdPartyDomains: MAX_THIRD_PARTY_DOMAINS,
        });
        return NextResponse.json(result, { headers: allHeaders });
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      inFlightScans--;
      const left = (inFlightByBucket.get(bucket) ?? 1) - 1;
      // Delete at zero. Keeping the key would grow this map by one entry per
      // network that ever scanned — a leak an attacker chooses the size of.
      if (left > 0) inFlightByBucket.set(bucket, left);
      else inFlightByBucket.delete(bucket);
    }
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
    console.error(`Scan error (${errorType}): ${err instanceof Error ? err.message : 'unknown'}`);
    return NextResponse.json({ error: 'An unexpected error occurred while scanning.' }, { status: 500, headers: allHeaders });
  }
}
