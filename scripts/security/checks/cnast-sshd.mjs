/**
 * The one management port that faces the internet.
 *
 * Deploys authenticate as root — .secrets sets DEPLOY_USER=root and
 * scripts/deploy.sh:26-28 consumes it — so PermitRootLogin cannot simply be
 * `no` without redesigning the deploy. What it can be, and must be, is
 * `prohibit-password`: root by key only, never by anything typeable.
 *
 * The pairing is what matters. `PermitRootLogin yes` is survivable while
 * `PasswordAuthentication no` holds, and vice versa. Both together on a box
 * with a public IP means the whole system — WordPress, MySQL, the API and the
 * two secrets in /etc/ib-api.env — is one credential-stuffing run away. So this
 * check grades them as a pair and says which of the two is currently load
 * bearing, rather than reporting one line in isolation.
 *
 * `sshd -T` prints the effective configuration and starts no daemon. It is the
 * right source precisely because sshd_config on Ubuntu is now a directory of
 * fragments: /etc/ssh/sshd_config.d/*.conf is where cloud-init and package
 * upgrades drop their opinions, and reading the main file alone would miss
 * them.
 *
 * fail2ban is reported as information, never as a failure. It is not installed
 * here, and a nightly finding that says "consider installing fail2ban" is
 * generic hardening advice of exactly the kind that gets a suite muted. With
 * password authentication off, it also buys much less than it looks like.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

export default check({
  id: 'sshd-exposure',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'sshd still refuses passwords and permits root by key only — the pair that keeps the one internet-facing management port out of reach of a credential-stuffing run.',
  async run(ctx) {
    const want = baseline(ctx).sshd.expect;
    const sections = droplet(ctx);
    const raw = section(ctx, sections, 'SSHD');

    const cfg = new Map();
    for (const line of raw.split('\n')) {
      const m = /^\s*(\w+)\s+(.*)$/.exec(line);
      if (m) cfg.set(m[1].toLowerCase(), m[2].trim().toLowerCase());
    }
    if (!cfg.size) throw new ctx.Skip(`sshd -T returned nothing parseable: ${raw.slice(0, 200)}`);

    const findings = [];
    let checked = 0;

    const passwordAuth = cfg.get('passwordauthentication');
    const rootLogin = cfg.get('permitrootlogin');
    const passwordsOff = passwordAuth === 'no' && cfg.get('kbdinteractiveauthentication') === 'no';

    checked++;
    if (passwordAuth !== want.passwordauthentication) {
      findings.push(finding({
        severity: rootLogin === 'yes' ? 'critical' : 'high',
        title: `sshd accepts password authentication (PasswordAuthentication ${passwordAuth || 'unset'})`,
        detail: rootLogin === 'yes'
          ? 'Together with PermitRootLogin yes this is a password-guessable root account on a public IP. Everything on the box is behind it: the team\'s WordPress and MySQL, and both secrets in /etc/ib-api.env.'
          : 'Password authentication on a public port invites credential stuffing against every account on the box. Key-only is the posture the deploy already uses.',
        evidence: `sshd -T → passwordauthentication ${passwordAuth || '(absent)'}, permitrootlogin ${rootLogin || '(absent)'}`,
        remediation: 'PasswordAuthentication no in /etc/ssh/sshd_config.d/*.conf, then sshd -t && systemctl reload ssh. Confirm your key works in a second session first.',
      }));
    }

    checked++;
    if (rootLogin !== want.permitrootlogin) {
      const yes = rootLogin === 'yes';
      findings.push(finding({
        severity: yes && !passwordsOff ? 'critical' : 'medium',
        title: `PermitRootLogin is ${rootLogin || 'unset'}, not ${want.permitrootlogin}`,
        detail: passwordsOff
          ? 'Not exploitable as it stands: password and keyboard-interactive authentication are both off, so root is reachable by key only in practice. What it costs is the second layer. The whole protection now rests on one directive in a file that package upgrades and cloud-init both write to — restore password authentication by accident and root becomes guessable in the same moment, with nothing else to stop it. `prohibit-password` makes that impossible rather than merely unlikely.'
          : 'Root is loginable and passwords are not fully disabled, which is the combination that turns a public ssh port into a standing credential-stuffing target.',
        evidence: `sshd -T → permitrootlogin ${rootLogin || '(absent)'}, passwordauthentication ${passwordAuth || '(absent)'}, kbdinteractiveauthentication ${cfg.get('kbdinteractiveauthentication') || '(absent)'}`,
        remediation: 'PermitRootLogin prohibit-password. Deploys keep working: .secrets uses key authentication as root already, and prohibit-password permits exactly that.',
      }));
    }

    for (const key of ['kbdinteractiveauthentication', 'permitemptypasswords']) {
      checked++;
      const got = cfg.get(key);
      if (got !== want[key]) {
        findings.push(finding({
          severity: key === 'permitemptypasswords' ? 'high' : 'medium',
          title: `sshd has ${key} ${got || 'unset'}, expected ${want[key]}`,
          detail: key === 'permitemptypasswords'
            ? 'An empty password accepted on any account with one is an unauthenticated root path away from a single mistake.'
            : 'Keyboard-interactive is the second door into password authentication: disabling passwords while leaving this on has let PAM-backed password prompts through before.',
          evidence: `sshd -T → ${key} ${got || '(absent)'}`,
          remediation: `Set ${key === 'permitemptypasswords' ? 'PermitEmptyPasswords no' : 'KbdInteractiveAuthentication no'} and reload ssh.`,
        }));
      }
    }

    // Information, not a verdict.
    const f2b = (sections.FAIL2BAN || '').trim().split('\n').map((s) => s.trim()).filter(Boolean);
    findings.push(finding({
      severity: 'info',
      title: `fail2ban: ${f2b.join(' / ') || 'unknown'}`,
      detail: 'Reported, never graded. With password authentication off, fail2ban mostly trims log noise rather than closing a path in, and a nightly line recommending software nobody decided to install is how a suite gets muted.',
      evidence: `systemctl is-active fail2ban; systemctl is-enabled fail2ban → ${f2b.join(' / ') || '(no output)'}; sshd port ${cfg.get('port') || '?'}`,
    }));

    return { findings, checked };
  },
});
