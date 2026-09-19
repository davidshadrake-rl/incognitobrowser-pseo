/**
 * The laptop side of the trust boundary the rest of this discipline describes.
 *
 * ADDED BEYOND THE SPECIFICATION, on the reviewer's point. Every other cnast
 * check watches the droplet. None of them watch the credential that reaches it,
 * which is the highest-value secret in the whole system: .secrets sets
 * DEPLOY_USER=root and DEPLOY_SSH_KEY points at a key authorized for root on a
 * box that runs the team's WordPress, MySQL, our two sites and the API.
 *
 * And it lives on a developer machine that runs `npm ci` against a tree with
 * known npm-audit findings. Everything the nightly suite proves about the
 * droplet's posture is worth nothing if that key is readable by anything else
 * on this machine, or if it is unencrypted at rest and ends up in a backup, a
 * synced folder, or a stolen laptop.
 *
 * Offline and instant, so it runs on every commit rather than nightly: three
 * `stat` calls and one header read.
 *
 * THE KEY IS NEVER READ IN FULL. Only the first 512 bytes, which is enough to
 * see the OpenSSH cipher name, and no part of that is ever put into a finding.
 * A check that leaks the credential it is protecting would be a worse bug than
 * anything it could find.
 *
 * Skip, not pass, when .secrets is absent: a machine with no deploy credential
 * has nothing to grade here, and reporting a clean result would suggest
 * otherwise.
 *
 * Deliberately NOT flagged: which key algorithm is in use, or its age. Both are
 * generic advice this project has no reason to act on, and the noise would
 * dilute the two findings above that actually matter.
 */
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

/**
 * Is an OpenSSH private key encrypted?
 *
 * New-format keys ("BEGIN OPENSSH PRIVATE KEY") are base64 around a binary
 * blob: the magic "openssh-key-v1\0", then a length-prefixed cipher name. That
 * name is literally "none" for an unencrypted key. Old PEM keys announce
 * themselves with a Proc-Type/DEK-Info header instead.
 *
 * Returns null when the format is unrecognised — reported as unknown, never
 * assumed safe.
 */
function keyIsEncrypted(head) {
  if (/Proc-Type:\s*4,ENCRYPTED/i.test(head) || /DEK-Info:/i.test(head)) return true;
  const m = /-----BEGIN OPENSSH PRIVATE KEY-----\s*([\sA-Za-z0-9+/=]+)/.exec(head);
  if (!m) return null;
  const b64 = m[1].replace(/\s+/g, '');
  const usable = b64.slice(0, Math.floor(b64.length / 4) * 4);
  if (usable.length < 32) return null;
  let blob;
  try { blob = Buffer.from(usable, 'base64'); } catch { return null; }
  const magic = 'openssh-key-v1\0';
  if (blob.subarray(0, magic.length).toString('binary') !== magic) return null;
  const nameLen = blob.readUInt32BE(magic.length);
  if (!Number.isFinite(nameLen) || nameLen <= 0 || nameLen > 64) return null;
  const cipher = blob.subarray(magic.length + 4, magic.length + 4 + nameLen).toString('ascii');
  return cipher !== 'none';
}

function modeOf(path) {
  return (statSync(path).mode & 0o777).toString(8).padStart(3, '0');
}

export default check({
  id: 'deploy-credential-hygiene',
  discipline: 'cnast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The root deploy credential on this machine — .secrets and the ssh key it names — is 0600, encrypted at rest, and outside the repo.',
  async run(ctx) {
    const secretsPath = join(ctx.repoRoot, '.secrets');
    if (!existsSync(secretsPath)) {
      throw new ctx.Skip('no .secrets on this machine — there is no deploy credential here to grade');
    }

    const findings = [];
    let checked = 0;

    checked++;
    const secretsMode = modeOf(secretsPath);
    if (secretsMode !== '600') {
      findings.push(finding({
        severity: 'high',
        title: `.secrets is mode ${secretsMode}, not 600`,
        detail: 'It names the deploy host, the root user and the path to a key authorized for root on the production box. Anything else on this machine that can read it knows exactly what to steal next.',
        evidence: `stat .secrets → mode ${secretsMode} at ${secretsPath}`,
        remediation: 'chmod 600 .secrets',
        file: '.secrets',
      }));
    }

    // Parse without sourcing: this process has no business inheriting these.
    const vars = {};
    for (const line of readFileSync(secretsPath, 'utf-8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }

    const keyRef = vars.DEPLOY_SSH_KEY;
    if (!keyRef) {
      return {
        checked,
        findings: [...findings, finding({
          severity: 'info',
          title: '.secrets names no DEPLOY_SSH_KEY',
          detail: 'Nothing to grade for the key half. Reported so the gap in coverage is visible rather than silent.',
          evidence: `.secrets keys present: ${Object.keys(vars).join(', ') || '(none parsed)'}`,
        })],
      };
    }

    const keyPath = resolve(keyRef.replace(/^~/, process.env.HOME || '~'));
    if (!existsSync(keyPath)) {
      return {
        checked: checked + 1,
        findings: [...findings, finding({
          severity: 'medium',
          title: 'DEPLOY_SSH_KEY points at a file that does not exist',
          detail: 'Not a security hole by itself, but every ssh-backed check in this suite will Skip on this machine, and the nightly infrastructure posture goes ungraded as a result.',
          evidence: `.secrets DEPLOY_SSH_KEY → ${keyRef} (resolved ${keyPath}: not found)`,
          remediation: 'Point DEPLOY_SSH_KEY at the real key, or remove it so the skip reason is honest.',
        })],
      };
    }

    checked++;
    const keyMode = modeOf(keyPath);
    if (!['600', '400'].includes(keyMode)) {
      findings.push(finding({
        severity: 'high',
        title: `The root deploy key is mode ${keyMode}`,
        detail: 'A private key readable beyond its owner is a root login to the production box available to anything else running on this machine. ssh itself refuses to use such a key, so this usually shows up as a broken deploy first — but the exposure starts the moment the mode changes.',
        evidence: `stat ${keyPath} → mode ${keyMode}`,
        remediation: `chmod 600 ${keyPath}`,
      }));
    }

    checked++;
    let head = '';
    const fd = openSync(keyPath, 'r');
    try {
      const buf = Buffer.alloc(512);
      const n = readSync(fd, buf, 0, 512, 0);
      head = buf.subarray(0, n).toString('utf-8');
    } finally {
      closeSync(fd);
    }
    const encrypted = keyIsEncrypted(head);
    if (encrypted === false) {
      findings.push(finding({
        // Medium, not high, and the reasoning belongs in the open. An
        // unencrypted key on a laptop with full-disk encryption is not the
        // stolen-hardware disaster it is usually described as — that case is
        // already covered. The case this does cover is the one this repo
        // actually has: `npm ci` over a tree with known advisories, where a
        // single malicious postinstall reads ~/.ssh and walks away with root on
        // production. That is worth a standing warning. It is not worth
        // blocking every build in the repo over a decision that belongs to
        // whoever owns the machine, which is what grading it `high` would do —
        // and a suite that blocks builds over someone's personal setup is a
        // suite that gets muted, taking the droplet findings with it.
        severity: 'medium',
        title: 'The root deploy key has no passphrase',
        detail: 'At rest it is a plain root credential for the production box. The realistic path here is not a stolen laptop — it is this repo: a malicious postinstall during `npm ci` reads ~/.ssh and has root on the box that serves the team\'s WordPress. A passphrase plus ssh-agent costs one prompt per session and makes the file useless on its own.',
        evidence: `${keyPath}: OpenSSH private key with cipher "none" (read from the first 512 bytes; no key material is reproduced here)`,
        remediation: `ssh-keygen -p -f ${keyPath} to add a passphrase, then ssh-add it once per session. Better still, issue a non-root deploy user with a narrower authorized_keys command.`,
      }));
    } else if (encrypted === null) {
      findings.push(finding({
        severity: 'info',
        title: 'Could not tell whether the deploy key is passphrase-protected',
        detail: 'Unrecognised key format. Reported as unknown rather than assumed encrypted — this check exists because an unencrypted root credential is easy to create by accident and impossible to notice.',
        evidence: `${keyPath}: first line "${(head.split('\n')[0] || '').slice(0, 60)}"`,
        remediation: 'Check by hand: ssh-keygen -y -f <key> prompts for a passphrase if there is one.',
      }));
    }

    // Inside the repo is a different failure: one `git add -f`, or one glob in
    // a future deploy script that rsyncs more than it means to.
    checked++;
    if (keyPath.startsWith(resolve(ctx.repoRoot) + '/')) {
      findings.push(finding({
        severity: 'critical',
        title: 'The root deploy key is inside the repository working tree',
        detail: 'A key that lives in the repo is one `git add -f` from being committed and one over-broad rsync from being published to the web root. Keys belong in ~/.ssh.',
        evidence: `.secrets DEPLOY_SSH_KEY → ${keyRef} resolves to ${keyPath}, inside ${ctx.repoRoot}`,
        remediation: 'Move the key to ~/.ssh and update DEPLOY_SSH_KEY.',
      }));
    }

    return { findings, checked };
  },
});
