#!/usr/bin/env bash
#
# Stop the scanner process being able to reach the private network at all.
#
#   ./scripts/droplet-egress-lockdown.sh            show what would change
#   ./scripts/droplet-egress-lockdown.sh --apply    apply and persist it
#   ./scripts/droplet-egress-lockdown.sh --verify   prove it is working
#   ./scripts/droplet-egress-lockdown.sh --revert   take it back off
#
# ## Why this exists, and why the TypeScript guards are not enough
#
# /api/scan-url fetches a URL the caller chooses. Everything that stops it
# fetching an INTERNAL URL is, today, a decision made in JavaScript:
# isPublicUnicastAddress() judges the resolved addresses, the port allowlist
# narrows the targets, redirects are refused. Those are good controls and they
# are tested. They also share one fatal property — they are all upstream of a
# fetch() that resolves the hostname a SECOND time.
#
# That gap has a name, DNS rebinding, and no amount of care in the address
# parser closes it: a name that answers 93.184.216.34 when the route asks and
# 10.116.0.7 when fetch() asks passes every check, because what was judged is
# not what gets connected to. It is not a bug to fix. It is the shape of the
# design.
#
# This droplet makes the consequence specific. It is on a DigitalOcean VPC:
#
#     eth0  206.189.186.34/20      public
#     eth0  10.10.0.5/16           private
#     eth1  10.116.0.2/20          private
#
# So "the Pro scanner can be used as a window into our internal network" is
# literally true as deployed — the process can route into two private ranges,
# and whatever else the company runs in them.
#
# The fix is not another check. It is to take the capability away: the kernel
# refuses the packet based on WHICH UID sent it, long after the JavaScript had
# its say. Then a rebind resolves to 10.116.0.7, fetch() connects, and the
# connection is refused by the host it is leaving. Parser bugs stop mattering.
# TOCTOU stops mattering. The scanner keeps working, because scanning the
# public web needs none of this.
#
# ## What it does not do
#
# It does not stop the scanner reaching internal services that live on PUBLIC
# addresses. Nothing at this layer can — a public IP is indistinguishable from
# any other public IP, which is exactly the point made in lib/net-address.ts.
# If the company runs something sensitive on a public address, put it behind
# authentication or behind the VPC; this script cannot help.
#
# ## Facts this is built on, read off the box on 2026-09-21
#
#   ib-api        uid 999                    the service user
#   DNS           127.0.0.53                 systemd-resolved, MUST stay open
#   Redis         127.0.0.1:6379             the rate limiter, MUST stay open
#
# Those two exceptions are why this is a per-UID egress policy rather than
# "block RFC 1918" — the process legitimately needs two loopback services, and
# a rule that broke either would take the API down rather than secure it.
set -uo pipefail

MODE="${1:-}"
UID_OWNER=999          # ib-api
REDIS_PORT=6379
RESOLVER=127.0.0.53
CHAIN=IB_API_EGRESS

# Ranges the scanner has no business reaching. 10/8 covers both VPC ranges on
# this box; the rest are the IANA special-purpose blocks that are routable
# enough to matter. Kept deliberately in step with V4_SPECIAL in
# lib/net-address.ts, so the kernel and the parser refuse the same things.
DENY_V4=(
  10.0.0.0/8          # RFC 1918 — and this droplet's VPC
  172.16.0.0/12       # RFC 1918
  192.168.0.0/16      # RFC 1918
  169.254.0.0/16      # link-local, and the cloud metadata address
  100.64.0.0/10       # carrier-grade NAT
  192.0.0.0/24        # IETF protocol assignments
  198.18.0.0/15       # benchmarking
  224.0.0.0/4         # multicast
  240.0.0.0/4         # reserved
)
DENY_V6=(
  fc00::/7            # unique local
  fe80::/10           # link-local
  ff00::/8            # multicast
)

rules_v4() {
  # Order is the policy.
  #
  # FIRST: replies on connections somebody else opened. OUTPUT filters every
  # packet the uid sends, and that includes the API answering Apache — those
  # packets go to 127.0.0.1:<ephemeral port>, which the loopback REJECT below
  # matches. Without this rule the API cannot reply to anyone and every route
  # returns 503. That is exactly what happened on the first --apply, on
  # 2026-09-22, and --verify said "ok" five times while it was happening,
  # because every probe was a NEW outbound connection and none was an inbound
  # request. A new connection from the API into the VPC is state NEW, so it
  # falls straight past this rule to the REJECTs — the protection is intact.
  echo "-A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT"
  # Then the two loopback services the process needs, ahead of the loopback
  # REJECT, or the API loses DNS and Redis and the box looks like it is down.
  echo "-A $CHAIN -d $RESOLVER -p udp --dport 53 -j ACCEPT"
  echo "-A $CHAIN -d $RESOLVER -p tcp --dport 53 -j ACCEPT"
  echo "-A $CHAIN -d 127.0.0.1 -p tcp --dport $REDIS_PORT -j ACCEPT"
  echo "-A $CHAIN -d 127.0.0.0/8 -j REJECT --reject-with icmp-port-unreachable"
  for net in "${DENY_V4[@]}"; do
    echo "-A $CHAIN -d $net -j REJECT --reject-with icmp-net-unreachable"
  done
}

show() {
  echo "Would create chain $CHAIN, jump to it from OUTPUT for uid $UID_OWNER, and install:"
  echo
  rules_v4 | sed 's/^/    iptables /'
  echo
  echo "    ip6tables -A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT"
  for net in "${DENY_V6[@]}"; do echo "    ip6tables -A $CHAIN -d $net -j REJECT"; done
  echo
  echo "Effect: the ib-api process keeps DNS, Redis and the whole public internet."
  echo "        It loses both VPC ranges, all of RFC 1918, and the metadata address."
  echo
  echo "Nothing has been changed. Re-run with --apply to install it."
}

remote() {
  [ -f .secrets ] || { echo "No .secrets file." >&2; exit 1; }
  # shellcheck disable=SC1091
  source .secrets
  ssh -i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes "$DEPLOY_USER@$DEPLOY_HOST" "$1"
}

apply() {
  local script
  script="$(cat <<REMOTE
set -e
# Idempotent: rebuild the chain from empty every time rather than appending to
# whatever a previous run left. A half-applied egress policy is worse than
# none, because it looks applied.
iptables -N $CHAIN 2>/dev/null || iptables -F $CHAIN
ip6tables -N $CHAIN 2>/dev/null || ip6tables -F $CHAIN
$(rules_v4 | sed 's/^/iptables /')
ip6tables -A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
$(for net in "${DENY_V6[@]}"; do echo "ip6tables -A $CHAIN -d $net -j REJECT"; done)
# Jump from OUTPUT, once. -C tests for an existing identical rule.
iptables  -C OUTPUT -m owner --uid-owner $UID_OWNER -j $CHAIN 2>/dev/null || iptables  -I OUTPUT 1 -m owner --uid-owner $UID_OWNER -j $CHAIN
ip6tables -C OUTPUT -m owner --uid-owner $UID_OWNER -j $CHAIN 2>/dev/null || ip6tables -I OUTPUT 1 -m owner --uid-owner $UID_OWNER -j $CHAIN
# Persist across reboot. Without this the box comes back open and nothing says so.
DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null 2>&1 || true
mkdir -p /etc/iptables
iptables-save  > /etc/iptables/rules.v4
ip6tables-save > /etc/iptables/rules.v6
echo "applied and persisted"
REMOTE
)"
  remote "$script"
}

verify() {
  # Proof, not assertion. Three probes as the ib-api user: one that must work,
  # two that must not. Run as ib-api via setpriv so the uid match applies.
  remote "$(cat <<'REMOTE'
set -u
probe() { # label, target, expect-ok(0/1)
  if setpriv --reuid=999 --regid=988 --clear-groups \
       curl -s -o /dev/null -m 6 "$2" 2>/dev/null; then got=reached; else got=refused; fi
  want=$([ "$3" = 1 ] && echo reached || echo refused)
  if [ "$got" = "$want" ]; then printf '  ok    %-34s %s\n' "$1" "$got"
  else printf '  FAIL  %-34s got %s, wanted %s\n' "$1" "$got" "$want"; fi
}
# The probe that was missing the first time. Everything below is the API
# making NEW outbound connections; this is somebody else connecting TO the
# API, which it must be able to answer. Run first, because if this fails the
# rest of the output is describing a dead service.
# POST, because /api/ip is POST-only and answers a GET with 405. The first
# version of this probe sent a GET and expected 200, so it reported the API
# down — and told the operator to --revert — while the smoke suite was passing
# every route. A verification that can cry wolf with a destructive instruction
# attached is its own outage.
code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -X POST \
     -H 'origin: https://206-189-186-34.nip.io' -H 'content-type: application/json' \
     https://206-189-186-34.nip.io/api/ip 2>/dev/null)
if [ "$code" = "200" ]; then
  echo "  ok    the API answers an inbound request through Apache (200)"
else
  echo "  FAIL  the API does NOT answer through Apache (got '$code'). If every route is 503, run --revert."
fi
echo "as uid 999 (ib-api):"
probe "the public internet"            "https://example.com/"      1
probe "this VPC, eth0 10.10.0.5"       "http://10.10.0.5/"         0
probe "this VPC, eth1 10.116.0.2"      "http://10.116.0.2/"        0
probe "cloud metadata 169.254.169.254" "http://169.254.169.254/"   0
probe "its own WordPress on loopback"  "http://127.0.0.1/"         0
echo
echo "redis and dns, which must still work:"
setpriv --reuid=999 --regid=988 --clear-groups redis-cli -h 127.0.0.1 ping 2>&1 | sed 's/^/  redis: /'
setpriv --reuid=999 --regid=988 --clear-groups getent hosts example.com >/dev/null 2>&1 \
  && echo "  dns:   resolves" || echo "  dns:   FAILS — the API cannot scan anything"
REMOTE
)"
}

revert() {
  remote "iptables -D OUTPUT -m owner --uid-owner $UID_OWNER -j $CHAIN 2>/dev/null; \
          ip6tables -D OUTPUT -m owner --uid-owner $UID_OWNER -j $CHAIN 2>/dev/null; \
          iptables -F $CHAIN 2>/dev/null; iptables -X $CHAIN 2>/dev/null; \
          ip6tables -F $CHAIN 2>/dev/null; ip6tables -X $CHAIN 2>/dev/null; \
          iptables-save > /etc/iptables/rules.v4; ip6tables-save > /etc/iptables/rules.v6; \
          echo 'reverted'"
}

case "$MODE" in
  --apply)  apply && echo && verify ;;
  --verify) verify ;;
  --revert) revert ;;
  *)        show ;;
esac
