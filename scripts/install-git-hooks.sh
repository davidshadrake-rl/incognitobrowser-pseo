#!/bin/bash
# Installs the commit-identity pre-commit hook, and pins this clone's identity.
#
# Hooks live in .git/hooks, which git does not track, so a fresh clone has none
# until this runs. Run once after cloning:  bash scripts/install-git-hooks.sh
#
# Why: git falls back to a machine-wide default identity when a clone has no
# local override, so a fresh clone can commit under the wrong name.
# tests/repo-identity.test.ts enforces the same rule at build time; this hook
# catches it earlier, at commit time.
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_NAME="davidshadrake-rl"
EXPECTED_EMAIL="david@radiuslabs.com"

git config --local user.name "$EXPECTED_NAME"
git config --local user.email "$EXPECTED_EMAIL"

mkdir -p .git/hooks
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/bash
# Blocks a commit attributed to anyone but this project's owner.
# See scripts/install-git-hooks.sh
EXPECTED_EMAIL="david@radiuslabs.com"
EMAIL="$(git config user.email || true)"

if [ "$EMAIL" != "$EXPECTED_EMAIL" ]; then
  echo "BLOCKED: commit identity is '${EMAIL:-unset}', expected '$EXPECTED_EMAIL'." >&2
  echo "Fix:  git config --local user.email \"$EXPECTED_EMAIL\"" >&2
  exit 1
fi
HOOK

chmod +x .git/hooks/pre-commit
echo "installed .git/hooks/pre-commit"
echo "local identity: $(git config user.name) <$(git config user.email)>"
