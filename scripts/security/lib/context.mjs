/**
 * What a check is handed to do its work: paths, the live bases, a droplet
 * shell, and an HTTP helper that will not wedge the run.
 *
 * Everything that can be absent is absent explicitly — a check asks for `ssh`
 * and gets a function that throws Skip if .secrets has no droplet login,
 * rather than a silent no-op. See the design rules in harness.mjs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Skip } from './harness.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Parse .secrets without sourcing it — this process should not inherit those values. */
function readSecrets() {
  const p = join(REPO_ROOT, '.secrets');
  if (!existsSync(p)) return null;
  const out = {};
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function buildContext(opts = {}) {
  const secrets = readSecrets();
  const siteOrigin = opts.origin || secrets?.SITE_ORIGIN || 'https://206-189-186-34.nip.io';

  /**
   * Run a command on the droplet. Throws Skip (not an error) when there is no
   * login configured, so a laptop without .secrets reports SKIPPED for the
   * infrastructure checks instead of failing the whole run — or, worse,
   * passing it.
   */
  const ssh = (command, { timeoutMs = 30_000 } = {}) => {
    if (!secrets?.DEPLOY_HOST || !secrets?.DEPLOY_USER || !secrets?.DEPLOY_SSH_KEY) {
      throw new Skip('no droplet login in .secrets (DEPLOY_HOST/DEPLOY_USER/DEPLOY_SSH_KEY)');
    }
    if (!existsSync(secrets.DEPLOY_SSH_KEY.replace(/^~/, process.env.HOME || '~'))) {
      throw new Skip(`ssh key not found at ${secrets.DEPLOY_SSH_KEY}`);
    }
    try {
      return execFileSync('ssh', [
        '-i', secrets.DEPLOY_SSH_KEY.replace(/^~/, process.env.HOME || '~'),
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
        `${secrets.DEPLOY_USER}@${secrets.DEPLOY_HOST}`, command,
      ], { encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') throw new Skip(`ssh timed out: ${command.slice(0, 60)}`);
      // A non-zero exit is often the ANSWER (grep found nothing, test -f failed),
      // so hand back stdout rather than exploding. Checks decide what it means.
      return (err.stdout || '') + (err.stderr || '');
    }
  };

  /**
   * HTTP with a hard deadline. Returns a plain object instead of throwing, so
   * one unreachable URL cannot abort a whole check — the check decides whether
   * "unreachable" is a finding or a skip.
   */
  /**
   * Connection-level failures that mean "the socket was no good", not "the
   * server said no". These are retried once, on a fresh connection.
   *
   * Node's global fetch pools keep-alive sockets. Apache closes an idle one
   * after KeepAliveTimeout (5s by default), and a run like this one leaves
   * long gaps between requests to the same origin while the ssh-based checks
   * work. undici then hands out a socket the server has already closed and the
   * request fails in about a millisecond with UND_ERR_SOCKET.
   *
   * That was not theoretical: secret-published-dotfile-probe SKIPPED on every
   * full run and passed 3/3 in isolation, so a live check silently graded
   * nothing whenever it ran with the others — reported as "unreachable", which
   * reads like the site being down rather than a bug in this file.
   */
  const RETRYABLE = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ECONNABORTED']);

  const httpOnce = async (url, init = {}) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), init.timeoutMs || 15_000);
    try {
      const res = await fetch(url, { redirect: 'manual', ...init, signal: ac.signal });
      const text = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { ok: true, status: res.status, headers: res.headers, text, json, url };
    } catch (err) {
      // Unwrap the cause. undici reports every transport failure as the string
      // "fetch failed" and puts the actual reason — ECONNRESET, ECONNREFUSED,
      // UND_ERR_CONNECT_TIMEOUT, a TLS alert — on err.cause. A check that
      // skips with "unreachable: fetch failed" tells whoever reads the report
      // nothing they can act on, which is how a blind spot stays a blind spot.
      const cause = err && err.cause;
      const detail = cause ? ` (${cause.code || ''}${cause.code && cause.message ? ': ' : ''}${cause.message || ''})`.trim() : '';
      const aborted = err && err.name === 'AbortError';
      return {
        ok: false, status: 0, headers: new Headers(), text: '', json: null, url,
        error: aborted
          ? `timed out after ${init.timeoutMs || 15_000}ms`
          : `${String(err && err.message || err)}${detail}`,
        code: (cause && cause.code) || (aborted ? 'ETIMEDOUT' : null),
      };
    } finally {
      clearTimeout(t);
    }
  };

  /**
   * One retry on a dead pooled socket, then report honestly.
   *
   * Deliberately ONE retry and only for the transport codes above: a check
   * that retries a real refusal would turn a finding into a pass, which is the
   * opposite of the point. Everything else — a 403, a timeout, a TLS
   * rejection — is returned first time as the result it is.
   */
  const http = async (url, init = {}) => {
    const first = await httpOnce(url, init);
    if (first.ok || !RETRYABLE.has(first.code)) return first;
    const again = await httpOnce(url, init);
    if (again.ok) return again;
    return { ...again, error: `${again.error} (retried once after ${first.code})` };
  };

  return {
    repoRoot: REPO_ROOT,
    origin: siteOrigin,
    freeBase: `${siteOrigin}/resources`,
    proBase: `${siteOrigin}/resources-pro`,
    apiBase: opts.api || `${siteOrigin}/api`,
    hasSecrets: Boolean(secrets),
    statsToken: opts.statsToken || process.env.STATS_TOKEN || null,
    ssh,
    http,
    Skip,
  };
}
