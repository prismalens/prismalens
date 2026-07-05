#!/bin/bash
# Sets up the Anthropic srt sandbox (ADR-0020 B.1 local/desktop provider) on a
# Linux/WSL2 machine: OS prerequisites, the srt runtime, the deepagents-acp
# harness, and a working-boundary self-check. Idempotent — safe to re-run.
#
# Usage:
#   ./scripts/setup-srt-sandbox.sh            # install + verify isolation
#   ./scripts/setup-srt-sandbox.sh --probe    # ...then run the egress allow/deny
#                                             # probe (the B.1 roadmap gate)
#   ./scripts/setup-srt-sandbox.sh --fix-userns
#                                             # apply the Ubuntu 24.04+ sysctl srt
#                                             # documents (needs sudo)
set -uo pipefail

PROBE=false
FIX_USERNS=false
for arg in "$@"; do
	case "$arg" in
		--probe) PROBE=true ;;
		--fix-userns) FIX_USERNS=true ;;
		*) echo "unknown flag: $arg (use --probe / --fix-userns)"; exit 2 ;;
	esac
done

PASS=0; WARN=0; FAIL=0
ok()   { echo "  [ok]   $1"; PASS=$((PASS+1)); }
warn() { echo "  [warn] $1"; WARN=$((WARN+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== 1/5 platform =="
case "$(uname -s)" in
	Linux) ;;
	Darwin) echo "  macOS detected — srt uses Seatbelt there; bubblewrap steps below are skipped." ;;
	*) bad "srt supports Linux/macOS only (Windows is alpha — run inside WSL2)"; exit 1 ;;
esac
if grep -qi microsoft /proc/version 2>/dev/null; then
	ok "WSL2 detected (prismalens's supported dev target for srt)"
fi
if ! command -v node >/dev/null; then bad "node not found — install Node >= 22 first"; exit 1; fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -ge 22 ]; then ok "node $(node -v)"; else bad "node $(node -v) — need >= 22"; exit 1; fi

echo "== 2/5 OS sandbox primitive =="
if [ "$(uname -s)" = "Linux" ]; then
	if command -v bwrap >/dev/null; then
		ok "bubblewrap present ($(bwrap --version 2>/dev/null || echo unknown))"
	else
		echo "  installing bubblewrap (needs sudo)..."
		sudo apt-get install -y bubblewrap >/dev/null 2>&1 && ok "bubblewrap installed" || { bad "could not install bubblewrap — install it manually"; exit 1; }
	fi
	# Ubuntu 24.04+ restricts unprivileged user namespaces; srt documents the sysctl.
	RESTRICT_FILE=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
	if [ -f "$RESTRICT_FILE" ] && [ "$(cat "$RESTRICT_FILE")" = "1" ]; then
		if $FIX_USERNS; then
			sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null && ok "userns restriction lifted (session-only; persist via /etc/sysctl.d)" || bad "sysctl failed"
		else
			warn "kernel.apparmor_restrict_unprivileged_userns=1 — bwrap may fail; re-run with --fix-userns"
		fi
	fi
	# The real test beats any sysctl reading: can bwrap actually build a namespace?
	# (bwrap requires filesystem args; a bare invocation fails for the wrong reason.)
	if bwrap --ro-bind / / --unshare-pid --die-with-parent -- /bin/true 2>/dev/null; then
		ok "bwrap namespace self-check"
	else
		warn "bwrap self-check failed — srt's own wrap (next section) is the authoritative check; if that fails too, see --fix-userns"
	fi
fi

echo "== 3/5 srt runtime =="
if command -v srt >/dev/null; then
	ok "srt already on PATH ($(srt --version 2>/dev/null || echo unknown))"
else
	echo "  installing @anthropic-ai/sandbox-runtime globally..."
	npm install -g @anthropic-ai/sandbox-runtime >/dev/null 2>&1 && ok "srt installed ($(srt --version 2>/dev/null || echo unknown))" || { bad "npm install -g @anthropic-ai/sandbox-runtime failed"; exit 1; }
fi
if srt -- /bin/echo srt-ok 2>/dev/null | grep -q srt-ok; then
	ok "srt wraps a child and relays stdio"
else
	bad "srt could not run a trivial child — fix section 2 first"
fi

echo "== 4/5 deepagents-acp harness =="
if command -v deepagents-acp >/dev/null; then
	ok "deepagents-acp already on PATH ($(deepagents-acp --version 2>/dev/null || echo unknown))"
else
	echo "  installing deepagents-acp globally..."
	npm install -g deepagents-acp >/dev/null 2>&1 && ok "deepagents-acp installed" || bad "npm install -g deepagents-acp failed"
fi
# Duplex-stdio smoke: the ACP initialize handshake through the srt boundary —
# exactly what `pl investigate --sandbox srt` does, no model key needed.
if command -v deepagents-acp >/dev/null; then
	HANDSHAKE=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}\n' \
		| timeout 30 srt -- deepagents-acp 2>/dev/null | head -1)
	if echo "$HANDSHAKE" | grep -q '"result"'; then
		ok "ACP initialize round-trip through the srt boundary (duplex stdio holds)"
	else
		warn "ACP handshake under srt did not answer — run Test 2 of the guide manually before relying on --sandbox srt"
	fi
fi

echo "== 5/5 egress allow/deny probe =="
if $PROBE; then
	SETTINGS=$(mktemp /tmp/srt-probe-XXXX.json)
	cat > "$SETTINGS" <<'EOF'
{ "network": { "allowedDomains": ["registry.npmjs.org"], "deniedDomains": [], "strictAllowlist": true },
  "filesystem": { "denyRead": [], "allowWrite": ["."], "denyWrite": [] } }
EOF
	probe_code() {
		# curl -w prints 000 itself on connect failure AND exits non-zero — `|| true`
		# (not `|| echo 000`) avoids double-printing; empty output normalises to 000.
		local code
		code=$(timeout 30 srt --settings "$SETTINGS" -- curl -sS -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true)
		code=${code:-000}
		echo "${code: -3}"
	}
	ALLOWED=$(probe_code https://registry.npmjs.org/)
	DENIED=$(probe_code https://example.com/)
	rm -f "$SETTINGS"
	echo "  allowed(registry.npmjs.org)=$ALLOWED denied(example.com)=$DENIED"
	if [ "$DENIED" != "000" ]; then
		bad "EGRESS GATE FAILED — the denied domain got through ($DENIED). Do NOT flip the sandbox default; report the outputs above."
	elif [ "$ALLOWED" != "000" ]; then
		ok "EGRESS GATE PASSED — allowed reached, denied blocked (record in the hub: flips agent.sandbox default to auto)"
	else
		bad "INCONCLUSIVE — both blocked: srt's egress proxy bridge is not working in this environment (known in nested containers). Re-run on a real host/WSL2."
	fi
else
	echo "  skipped (run with --probe — this is the B.1 roadmap gate, ~1 min)"
fi

echo
echo "== summary: $PASS ok · $WARN warn · $FAIL fail =="
if [ "$FAIL" -eq 0 ]; then
	echo "Ready: pl investigate --sandbox srt (or agent.sandbox: srt in prismalens.config.yaml)"
else
	exit 1
fi
