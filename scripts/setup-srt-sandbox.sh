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
	# srt's Linux prerequisites (README §"Platform-Specific Dependencies"):
	# bubblewrap (sandbox), socat (proxy bridge — REQUIRED for egress), ripgrep.
	NEED=()
	command -v bwrap  >/dev/null || NEED+=(bubblewrap)
	command -v socat  >/dev/null || NEED+=(socat)
	command -v rg     >/dev/null || NEED+=(ripgrep)
	if [ "${#NEED[@]}" -gt 0 ]; then
		echo "  installing srt prerequisites (${NEED[*]}) — needs sudo..."
		sudo apt-get install -y "${NEED[@]}" >/dev/null 2>&1 || { bad "could not install: ${NEED[*]} — install them manually"; exit 1; }
	fi
	for tool in bwrap socat rg; do
		command -v "$tool" >/dev/null && ok "$tool present" || bad "$tool missing (srt egress needs socat; sandbox needs bwrap)"
	done
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
	# Control: with no sandbox, does egress work at all here? Distinguishes a dead
	# proxy bridge (both 000 AND the host has egress) from a genuinely offline box.
	HOST=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://registry.npmjs.org/ 2>/dev/null || true)
	HOST=${HOST:-000}
	rm -f "$SETTINGS"
	echo "  in-sandbox: allowed(registry.npmjs.org)=$ALLOWED denied(example.com)=$DENIED · host(no-sandbox)=$HOST"
	if [ "$DENIED" != "000" ]; then
		bad "EGRESS GATE FAILED — the denied domain got through ($DENIED); the allowlist is not enforcing. Do NOT flip the sandbox default; report the outputs above."
	elif [ "$ALLOWED" != "000" ]; then
		ok "EGRESS GATE PASSED — allowed reached, denied blocked. Report this so agent.sandbox default can flip to auto."
	elif [ "$HOST" != "000" ]; then
		# Both in-sandbox probes fail but the host has egress ⇒ srt's in-netns proxy
		# bridge (socat → host mux) is not carrying traffic. Confirmed on WSL2/NAT
		# 2026-07-05 with all deps present — an srt/WSL limitation, NOT a prismalens
		# config bug (the mux comes up; the sandbox just can't reach it). Effect: a
		# harness under `--sandbox srt` gets NO egress here, so it cannot query
		# telemetry. Stay on the `process` floor locally (its egress works — the host
		# line proves it); enforced egress is E2B's job in cloud (ADR-0020), not srt
		# on a laptop. Try WSL mirrored networking (networkingMode=mirrored in
		# /etc/wsl.conf + `wsl --shutdown`) as a possible fix, then re-probe."
		bad "EGRESS BRIDGE DEAD — the sandbox has NO egress (both 000) though the host does ($HOST). srt's proxy bridge isn't reaching the sandbox on this WSL2 setup. Keep agent.sandbox=process locally; see the comment above for the mirrored-networking experiment."
	else
		warn "INCONCLUSIVE — the host itself has no egress ($HOST); can't judge the allowlist. Re-run on a connected machine."
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
