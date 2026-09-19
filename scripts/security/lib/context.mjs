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
  const http = async (url, init = {}) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), init.timeoutMs || 15_000);
    try {
      const res = await fetch(url, { redirect: 'manual', ...init, signal: ac.signal });
      const text = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { ok: true, status: res.status, headers: res.headers, text, json, url };
    } catch (err) {
      return { ok: false, status: 0, headers: new Headers(), text: '', json: null, url, error: String(err && err.message || err) };
    } finally {
      clearTimeout(t);
    }
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
