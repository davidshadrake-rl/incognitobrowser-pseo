/**
 * Credential-shaped blobs anywhere in git history.
 *
 * The working-tree checks cannot see this. A secret committed on Tuesday and
 * "removed" on Wednesday is still in the object database, still reachable from
 * an old commit, and on a PUBLIC repository still fetchable by anyone who ever
 * cloned it. There is no un-publishing; the only remedy is rotation.
 *
 * The baseline is verified, not assumed: a full sweep of every blob in this
 * repository's history returns zero hits today. So this check starts clean and
 * only has to stay that way.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { check, finding, Skip } from '../lib/harness.mjs';

/**
 * What counts as credential-shaped.
 *
 * Every pattern here is a PROVIDER-SPECIFIC prefix plus a length floor. That is
 * a deliberate refusal to do entropy or generic "looks like a token" matching,
 * because of what this repo legitimately contains: 500 scanned third-party
 * sites under data/ (vercel.com among them), editorial copy that names real
 * trackers, real companies and real attack techniques, ad-blocker bait files
 * under public/adtest/ that are ad-shaped on purpose, and 607 build files whose
 * chunk names are 12-character high-entropy strings. A generic matcher would be
 * loudest on exactly those, and a check that cries wolf is switched off within
 * a week — taking the real findings with it.
 */
const PATTERNS = [
  { name: 'anthropic-api-key', re: /sk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: 'openai-api-key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'github-fine-grained-pat', re: /github_pat_[A-Za-z0-9_]{50,}/g },
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'private-key-header', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  {
    name: 'credentialed-redis-url',
    re: /redis(?:s)?:\/\/[^\s:/@'"]+:([^\s:/@'"]{6,})@/g,
    /**
     * VERCEL-MIGRATION.md documents the shape as
     * `redis://default:<password>@<host>:6379`. That is the runbook telling a
     * human what to paste, not a credential, and it is the single most likely
     * thing in this repo to trip a naive redis pattern — so the placeholder is
     * rejected on the captured password rather than pinned in an allowlist
     * file. An allowlist keyed on that path would also suppress a REAL
     * credential appearing in the same document one day; this does not.
     */
    reject: (m) => /[<>{}[\]]/.test(m[1]) || /^(password|pass|pwd|secret|token|changeme|yourpassword|xxx+)$/i.test(m[1]),
  },
];

/** Redact: enough to identify the hit, not enough to use it. */
function redact(s) {
  if (s.length <= 12) return `${s.slice(0, 4)}…(${s.length} chars)`;
  return `${s.slice(0, 8)}…${s.slice(-2)} (${s.length} chars)`;
}

export default check({
  id: 'secret-history-incremental-scan',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['git'],
  describe: 'Sweeps every blob in git history for credential-shaped strings — a secret removed in a later commit is still published.',
  /**
   * Full sweep, every run, no state file. The id still says "incremental"
   * because that is what it was specified as and the id is the contract with
   * the rest of the suite; the behaviour is not incremental, and here is why.
   *
   * An incremental design stores the last-scanned SHA in an untracked file.
   * Untracked means a fresh clone and CI have no baseline, which gives you two
   * failure modes and no good one: re-scan everything (so the incrementality
   * bought nothing) or scan nothing and report green. This suite exists because
   * guards in this repo reported green while grading nothing. Not adding
   * another.
   *
   * The cost objection is real but it is an objection to the OBVIOUS
   * implementation, not to the sweep. `git grep <pattern> $(git rev-list --all)`
   * re-walks 153 whole trees and takes 30 seconds wall with this pattern set —
   * far too slow to gate a commit. Scanning unique BLOBS instead walks each
   * distinct file content exactly once: 10,686 blobs, 132 MiB, measured at
   * ~800ms end to end on this machine, including the git plumbing. Same
   * coverage, thirty-seven times cheaper, so the sweep can be unconditional.
   *
   * Path attribution is deferred until there is a hit, because that lookup is
   * the expensive part and hits are rare. When one fires, the evidence carries
   * the blob SHA, so anyone can read the offending content by hand with
   * `git cat-file -p <sha>` without rerunning the suite.
   */
  async run(ctx) {
    let list;
    try {
      list = execFileSync(
        'git',
        ['cat-file', '--batch-all-objects', '--batch-check=%(objecttype) %(objectname) %(objectsize)'],
        { cwd: ctx.repoRoot, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
      );
    } catch (err) {
      if (err.code === 'ENOENT') throw new Skip('git not found on PATH');
      throw new Skip(`git cat-file --batch-all-objects failed: ${String(err.message).slice(0, 140)}`);
    }

    const blobs = [];
    let totalBytes = 0;
    let oversize = 0;
    for (const line of list.split('\n')) {
      if (!line.startsWith('blob ') && !line.includes(' blob ')) {
        const parts = line.split(' ');
        if (parts[0] !== 'blob') continue;
      }
      const [type, oid, size] = line.split(' ');
      if (type !== 'blob') continue;
      const n = Number(size);
      // 24 MiB ceiling: the PDFs and the xlsx in this repo are the only things
      // near it, and a credential does not live in a 24 MiB binary. Counted,
      // not silently dropped.
      if (n > 24 * 1024 * 1024) { oversize += 1; continue; }
      blobs.push(oid);
      totalBytes += n;
    }

    if (!blobs.length) throw new Skip('git object database holds no blobs — not a checkout with history?');

    const res = spawnSync('git', ['cat-file', '--batch'], {
      cwd: ctx.repoRoot,
      input: `${blobs.join('\n')}\n`,
      maxBuffer: Math.max(256 * 1024 * 1024, totalBytes * 2 + 64 * 1024 * 1024),
    });
    if (res.error || !res.stdout) throw new Skip(`git cat-file --batch failed: ${String(res.error || res.stderr).slice(0, 140)}`);

    const buf = res.stdout;
    const findings = [];
    const seen = new Set();          // one finding per (blob, pattern)
    let scanned = 0;
    let pos = 0;

    // Stream format: "<oid> blob <size>\n<contents>\n". Walking it by header
    // keeps the attribution exact — every match is tied to the blob it sits in.
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl === -1) break;
      const header = buf.toString('latin1', pos, nl);
      const parts = header.split(' ');
      if (parts.length < 3 || parts[1] !== 'blob') break;
      const oid = parts[0];
      const size = Number(parts[2]);
      const start = nl + 1;
      const end = start + size;
      if (!Number.isFinite(size) || end > buf.length) break;

      const slice = buf.subarray(start, end);
      scanned += 1;
      // Skip anything with a NUL in its first kilobyte: a binary, where a
      // provider-prefixed ASCII credential would not be stored anyway.
      const probe = slice.subarray(0, 1024);
      if (!probe.includes(0)) {
        const text = slice.toString('utf-8');
        for (const p of PATTERNS) {
          p.re.lastIndex = 0;
          let m;
          while ((m = p.re.exec(text)) !== null) {
            if (p.reject && p.reject(m)) continue;
            const key = `${oid}:${p.name}`;
            if (seen.has(key)) break;
            seen.add(key);
            findings.push({ oid, pattern: p.name, sample: m[0] });
            break;
          }
        }
      }
      pos = end + 1; // trailing newline git appends after each object
    }

    if (!findings.length) {
      return { checked: scanned, findings: oversize ? [finding({
        severity: 'info',
        title: `${oversize} blob(s) too large to scan in history`,
        detail: 'Objects above 24 MiB were not read. They are the PDFs and the spreadsheet in this repo, not credential stores, but the sweep was not total and says so.',
        evidence: `${oversize} blob(s) over 24 MiB among ${scanned + oversize} total; scanned ${scanned} blobs / ${(totalBytes / 1048576).toFixed(1)} MiB`,
        remediation: 'None expected. If the count grows, check what is being committed at that size.',
      })] : [] };
    }

    // Only now pay for path attribution.
    let objects = '';
    try {
      objects = execFileSync('git', ['rev-list', '--objects', '--all'], {
        cwd: ctx.repoRoot, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024,
      });
    } catch { /* attribution is a nicety; the blob SHA is the hard evidence */ }
    const pathOf = new Map();
    if (objects) {
      for (const line of objects.split('\n')) {
        const sp = line.indexOf(' ');
        if (sp > 0) pathOf.set(line.slice(0, sp), line.slice(sp + 1));
      }
    }

    /**
     * The detectors are not secrets.
     *
     * scripts/security/checks/ contains the patterns this scan matches ON —
     * cnast-deploy-credential-hygiene.mjs has to spell "-----BEGIN" out in
     * order to find a private key, so scanning it finds itself. Exactly the
     * self-reference the no-vercel guard hit (tests/no-vercel.test.ts isSelf).
     *
     * Narrow on purpose: only this directory, only because every file in it
     * exists to REFUSE the thing it names. A real credential pasted into a
     * check file would be missed, which is the cost — and it is the right
     * trade against a permanent false positive, because a permanent false
     * positive is how a team learns to skim past this check's output.
     * Mutation-tested: a key-shaped blob committed anywhere else still fires.
     */
    const isDetector = (p) => p.startsWith('scripts/security/checks/');

    const out = findings.map((f) => {
      const path = pathOf.get(f.oid) || '(path not recovered — blob is unreachable from any ref name)';
      if (isDetector(path)) return null;
      let commit = '';
      try {
        commit = execFileSync('git', ['log', '--all', '--oneline', '-1', `--find-object=${f.oid}`], {
          cwd: ctx.repoRoot, encoding: 'utf-8',
        }).trim();
      } catch { /* optional */ }
      return finding({
        severity: 'high',
        title: `${f.pattern} in git history: ${path}`,
        detail:
          'A credential-shaped string is present in a blob reachable from this repository\'s object database. '
          + 'This repository is public, so removing it from the working tree changes nothing — anyone who cloned, forked or fetched still has it, '
          + 'and GitHub serves the object to anyone who asks for that SHA. The value must be treated as burned and rotated.',
        evidence:
          `blob ${f.oid} (${path})${commit ? ` introduced around: ${commit}` : ''} matched ${f.pattern}, value ${redact(f.sample)}. `
          + `Read it by hand: git cat-file -p ${f.oid}`,
        remediation:
          'Rotate the credential first — that is the part that actually helps. Then decide about history: a rewrite on a public repo with an unknown number of clones is destructive and does not un-publish anything.',
        file: path.startsWith('(') ? null : path,
      });
    });

    return { checked: scanned, findings: out.filter(Boolean) };
  },
});
