# Tool Audit — End-to-End Test Suite

A Playwright-based audit that exercises every tool: navigates to the tool
page, fills inputs, clicks the action button, and verifies meaningful output
appears. Designed to be run on-demand whenever you want to confirm the live
site is healthy — before releases, after deploys, after dependency updates.

## First-time setup

```bash
cd "/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo"
npm install                    # installs @playwright/test (already in package.json)
npm run test:e2e:install       # downloads Chromium browser binary (~150 MB, one-time)
```

After that, the suite is ready.

## Running the audit

### Against the DO test droplet (recommended)

The test droplet always has the latest committed code. This is the closest
mirror of what a real user would see:

```bash
npm run test:e2e:droplet
```

Targets `http://206.189.186.34/resources/...`. Takes ~2 minutes to run all 14
tests in headless mode.

### Against the Vercel deployment

For testing the API path specifically (cookie scanner, etc.) against Vercel:

```bash
npm run test:e2e:vercel
```

Targets `https://incognitobrowser-pseo.vercel.app/...`.

### Against your local dev server (for development)

```bash
npm run test:e2e
```

This auto-spawns `npm run dev` if it's not already running, then tests
against `http://localhost:3000`. The `webServer` config in
`playwright.config.ts` handles the startup automatically.

### Interactive mode (debugging individual failures)

```bash
npm run test:e2e:ui
```

Opens Playwright's UI mode — you see every test, click to run one, watch it
execute in a real browser, replay frame-by-frame on failure. Best for
diagnosing why a test failed.

### After a run

An HTML report lands in `playwright-report/`. Open it:

```bash
npx playwright show-report
```

Failures include screenshots automatically; retries include trace files you
can replay step-by-step.

## What gets tested

| # | Tool | What the test does |
|---|---|---|
| 1 | Password Strength | Weak password → low-score messaging |
| 2 | Password Strength | Strong password → high-score messaging |
| 3 | Password Generator | Click Generate → assert a password appears |
| 4 | Browser Privacy Audit | Click Run → assert at least one check renders |
| 5 | Text Encryption | Round-trip encrypt "hello world" → decrypt → assert match |
| 6 | Text Encryption | Decrypt with wrong passphrase → assert specific error (not generic) |
| 7 | URL Analyzer | `paypa1.com` → assert typosquat flag appears |
| 8 | URL Analyzer | `github.com` → assert "trusted/safe" indicator |
| 9 | Hash Generator | Input "abc" → assert SHA-256 result equals known value |
| 10 | Privacy Quiz | Answer through all questions → assert results page loads |
| 11 | Permission Checker | Page loads → assert camera + microphone state shown |
| 12 | Cookie Scanner | Scan `example.com` → assert API response renders (PoW + scan) |
| 13 | User Agent Analyzer | Page loads → assert browser + OS info shown |
| 14 | Metadata Viewer | Page loads → assert file upload control present |
| 15 | What's My IP | Page loads → assert public IPv4/IPv6 displayed |

15 tests total. All run in parallel by default.

## Pre-deploy checklist

Before every production deploy:

```bash
# 1. Run the unit tests
npm test

# 2. Run the E2E audit against your staging environment
npm run test:e2e:droplet

# 3. If both pass, deploy.
```

## CI/CD integration (future)

Add to GitHub Actions on every PR:

```yaml
# .github/workflows/e2e.yml
name: E2E Audit
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm run test:e2e:droplet
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

CI auto-runs against the test droplet on every push. PRs blocked if anything
breaks.

## Common failure patterns

| Symptom | Likely cause |
|---|---|
| Tests time out connecting to base URL | The droplet's `/resources/` route isn't responding — check Apache, .htaccess rule, or DNS |
| Cookie scanner test fails with 401/403 | API origin allowlist doesn't include test environment's origin |
| Privacy quiz test runs forever | Question selector is too greedy or the quiz advances differently than expected |
| Text encryption fails with unhelpful message | Browser is missing Web Crypto (rare) — should produce a clear message now |
| What's My IP test fails | Third-party API (ipify.org / ipapi.co) is down or rate-limited |

Each failure includes a screenshot in `playwright-report/data/` showing the
final state when the assertion failed. Open that first when debugging.

## When to update the tests

When you change a tool's UI or behavior, the corresponding test may need
updating. Examples that require test changes:

- Renamed a button or label
- Removed/renamed an input field
- Changed where the output renders
- Added a new tool engine (write a new test for it)

The tests are intentionally permissive (e.g., they match on `/strong|excellent|very strong/i`
instead of an exact string) so cosmetic copy changes don't break them. But
fundamental UI shifts will.
