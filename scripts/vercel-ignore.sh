#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
#   exit 0 = skip this build, exit 1 = build.
#
# Both Vercel projects deploy from this one repo, so every push built the site
# twice and each build is kept as Deployment Storage (~0.3 GB for the free
# site). The Pro deployment serves ONLY the Pro tool pages: it renders no
# guide, checklist, template, calculator, glossary entry, comparison or report
# card (lib/tiers.ts engineVisibleInThisTier, and the content routes return no
# params on Pro). A commit that touches only those files cannot change the Pro
# output, so that build is skipped.
#
# The free project always builds. So does Pro whenever any code, config, tool
# data, taxonomy or public asset changes, and whenever the parent commit is
# missing (a shallow clone), because then we cannot tell what changed.
# See https://vercel.com/docs/deployment-storage/optimize
set -u

[ "${NEXT_PUBLIC_TIER:-}" = "pro" ] || exit 1
git rev-parse --verify HEAD^ >/dev/null 2>&1 || exit 1

if git diff --quiet HEAD^ HEAD -- . \
  ':(exclude)data/guides' \
  ':(exclude)data/checklists' \
  ':(exclude)data/templates' \
  ':(exclude)data/calculators' \
  ':(exclude)data/glossary' \
  ':(exclude)data/comparisons' \
  ':(exclude)data/sites' \
  ':(exclude)data/authors'; then
  echo "Pro: this commit changes only free-site content; skipping the build."
  exit 0
fi
exit 1
