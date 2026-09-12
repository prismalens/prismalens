#!/usr/bin/env sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel
#
# Packed-artifact smoke (work-005 R0.d): prove the npm tarball installs and runs
# in a CLEAN environment — no pnpm, no monorepo, no devDependencies, no repo
# checkout. Catches what unit tests structurally cannot: missing `files`,
# undeclared dependencies, broken bin/shebang wiring, ESM resolution against
# the published layout, engines mismatches.
#
# Since #237 this is also the `pl up` gate: the tarball carries the NestJS API,
# the forked investigation child and the built SPA, so the smoke boots the whole
# application from the INSTALLED package and drives it over HTTP. A boot log
# without `[RouterExplorer] Mapped` lines means it did not boot — every HTTP
# assertion below is worthless in that case, so the route count is asserted
# FIRST and hard.
#
# Usage: packed-smoke.sh <dir-with-tarball>
#   The dir must hold the single published tarball from `node scripts/pack-cli.mjs`:
#   prismalens-<version>.tgz. The first-party @prismalens/* closure is COPIED
#   into it as bundleDependencies (issue #237, superseding #193's bundling) —
#   there is nothing else to install.
#
# Runs on POSIX sh + node + npm only (works inside node:24-slim). HTTP probes use
# node's built-in fetch — the slim images carry no curl.
set -eu

TARBALLS=$(cd "${1:?usage: packed-smoke.sh <dir-with-tarball>}" && pwd)
# Resolved BEFORE the cd below, and absolute: the HTTP probe is written into the
# installed package (see PROBE_MJS) and runs with cwd inside $SCRATCH, so it can
# only reach the shared Part A module (#551) by absolute path. This is the second
# entry in this job's sparse-checkout list in .github/workflows/ci.yml.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REFUSAL_GATE_LIB="$SCRIPT_DIR/../packages/@prismalens/engine/scripts/refusal-gate-check.mjs"
[ -f "$REFUSAL_GATE_LIB" ] || {
	echo "SMOKE FAIL: $REFUSAL_GATE_LIB is missing — widen the job's sparse-checkout" >&2
	exit 1
}
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
cd "$SCRATCH"

fail() {
	echo "SMOKE FAIL: $1" >&2
	exit 1
}

find_tarball() {
	# $1: filename prefix. The [0-9] in the glob anchors the version digit so
	# the prefix cannot accidentally match a differently-named tarball.
	for f in "$TARBALLS"/$1[0-9]*.tgz; do
		[ -e "$f" ] || fail "no tarball matching $1*.tgz in $TARBALLS"
		echo "$f"
		return
	done
}

CLI_TGZ=$(find_tarball "prismalens-")

echo "==> tarball:"
echo "    $CLI_TGZ"

echo "==> every @prismalens/* dependency is BUNDLED, and no workspace: leaks"
# Re-specified from the pre-#237 assertion ("no @prismalens/* in dependencies").
# The closure is no longer inlined by a bundler; it is copied into the tarball's
# own node_modules and declared in bundleDependencies. npm requires such a name
# in BOTH `dependencies` and `bundleDependencies` — in `dependencies` alone it
# would be fetched from a registry that has never seen it, and in
# `bundleDependencies` alone npm silently drops the files from the tarball.
tar -xzOf "$CLI_TGZ" package/package.json | node -e "
	const pkg = JSON.parse(require('fs').readFileSync(0, 'utf8'));
	const bundled = new Set(pkg.bundleDependencies ?? []);
	const deps = Object.entries(pkg.dependencies ?? {});
	const first = deps.filter(([n]) => n.startsWith('@prismalens/'));
	if (first.length === 0) { console.error('no @prismalens/* dependencies at all'); process.exit(1); }
	for (const [n, spec] of first) {
		if (!bundled.has(n)) { console.error(n + ' is not in bundleDependencies'); process.exit(1); }
	}
	for (const [n, spec] of deps) {
		if (String(spec).startsWith('workspace:') || String(spec).startsWith('catalog:')) {
			console.error(n + ' still carries an unresolved ' + spec); process.exit(1);
		}
	}
	console.log('    ' + first.length + ' bundled, ' + (deps.length - first.length) + ' installed from the registry');
" || fail "the tarball's dependency/bundleDependencies contract is broken"

cat > package.json <<EOF
{
	"name": "packed-smoke-scratch",
	"private": true,
	"dependencies": { "prismalens": "file:$CLI_TGZ" }
}
EOF

echo "==> npm install (clean scratch dir, engines enforced)"
npm install --engine-strict --no-audit --no-fund --loglevel=error || fail "npm install of the packed tarball failed"

BIN="$SCRATCH/node_modules/.bin"
[ -x "$BIN/prismalens" ] || fail "prismalens bin not linked"
[ -x "$BIN/pl" ] || fail "pl bin alias not linked"

echo "==> the copied first-party closure survived install"
# The mirror image of the pre-#237 assertion. `pl up` resolves @prismalens/api
# from HERE; if npm pruned it, the CLI still installs and `pl up` fails at the
# first user's first command.
PKG="$SCRATCH/node_modules/prismalens"
for p in api database engine config contracts logger auth integrations; do
	[ -d "$PKG/node_modules/@prismalens/$p" ] || fail "@prismalens/$p is missing from the installed package"
done
[ -f "$PKG/node_modules/@prismalens/api/public/index.html" ] || fail "the SPA is missing from the installed package"

echo "==> --version matches the packed package.json"
EXPECTED=$(node -p "require('$SCRATCH/node_modules/prismalens/package.json').version")
GOT=$("$BIN/prismalens" --version)
[ "$GOT" = "$EXPECTED" ] || fail "--version printed '$GOT', package.json says '$EXPECTED'"
echo "    $GOT"

echo "==> doctor fails LOUDLY on a machine with no harness"
# This is the first command a real user runs on a broken setup: the failure
# mode is part of the contract. Expect a nonzero exit and an actionable report.
set +e
DOCTOR_OUT=$("$BIN/pl" doctor 2>&1)
DOCTOR_EXIT=$?
set -e
[ "$DOCTOR_EXIT" -ne 0 ] || fail "doctor exited 0 in a clean env with no harness/credentials"
echo "$DOCTOR_OUT" | grep -qi "harness" || fail "doctor output does not mention the missing harness:
$DOCTOR_OUT"

echo "==> a machine with no agent is told it is not installed, never to run 'claude /login' (#518)"
# The clean-machine falsifier a developer box cannot run: node:24-slim carries no
# agent binary, so this is the only place the not-installed verdict is real
# rather than injected. The advice must name the gap the machine actually has.
#
# Loaded as a real .mjs INSIDE the packed install, not via createRequire:
# @prismalens/config is "type": "module" and its ./harness-auth subpath declares
# only an "import" condition, so the CJS loader cannot reach it
# (ERR_PACKAGE_PATH_NOT_EXPORTED). Anchoring the file in $PKG keeps the bare
# specifier resolving through the package's own exports map — the same door
# the API process goes through — instead of deep-linking past it into dist/.
PROBE_MJS="$PKG/prismalens-smoke-verdicts.mjs"
cat > "$PROBE_MJS" <<'VERDICTS'
import { listHarnessStatus } from "@prismalens/config/harness-selection";

for (const h of listHarnessStatus()) {
	console.log(`${h.id}|${h.installed ? "installed" : "not-installed"}|${h.install}`);
}
VERDICTS
set +e
VERDICT_OUT=$(node "$PROBE_MJS" 2>&1)
VERDICT_EXIT=$?
set -e
rm -f "$PROBE_MJS"
[ "$VERDICT_EXIT" -eq 0 ] || fail "could not resolve harness verdicts from the packed install:
$VERDICT_OUT"

echo "$VERDICT_OUT" | grep -q "opencode|not-installed|" || fail "opencode status on a no-agent machine is not 'not-installed':
$VERDICT_OUT"
echo "$VERDICT_OUT" | grep -q "claude-code|not-installed|" || fail "claude-code status on a no-agent machine is not 'not-installed':
$VERDICT_OUT"
echo "$VERDICT_OUT" | grep -qi "opencode.ai/install" || fail "status does not carry the install hint:
$VERDICT_OUT"
echo "    $(echo "$VERDICT_OUT" | head -1)"

echo "==> pl up boots the whole application from the installed package"
# Everything below drives the artifact under test over HTTP. It exists because a
# packaging change can leave the CLI perfectly installable and the APPLICATION
# unbootable — which is exactly what happened in spike #327.
UP_DIR="$SCRATCH/up"
mkdir -p "$UP_DIR"
UP_LOG="$UP_DIR/up.log"
PORT=${PRISMALENS_SMOKE_PORT:-3931}

# `pl up` FORKS a child per investigation, and this smoke starts one. Killing
# only the parent orphans it, which then holds the port and the scratch dir. So
# run the whole thing in its own process group and kill the group.
if command -v setsid >/dev/null 2>&1; then
	SETSID=setsid
else
	SETSID=
fi
PRISMALENS_WORKSPACE_DIR="$UP_DIR/workspace" \
PRISMALENS_HOST=127.0.0.1 \
PRISMALENS_PORT="$PORT" \
NODE_ENV=production \
	$SETSID "$BIN/pl" up > "$UP_LOG" 2>&1 &
UP_PID=$!
stop_up() {
	if [ -n "$SETSID" ]; then
		kill -TERM "-$UP_PID" 2>/dev/null || true
		kill -9 "-$UP_PID" 2>/dev/null || true
	fi
	kill -9 "$UP_PID" 2>/dev/null || true
}
# shellcheck disable=SC2064
trap "stop_up; rm -rf '$SCRATCH'" EXIT

i=0
while [ "$i" -lt 120 ]; do
	grep -q "PrismaLens API running" "$UP_LOG" 2>/dev/null && break
	kill -0 "$UP_PID" 2>/dev/null || break
	i=$((i + 1))
	sleep 1
done

# THE gate. #327 reported HTTP assertions for an artifact that never booted; the
# route table is the only thing that distinguishes the two, so it is checked
# before any probe and the boot log is dumped when it fails.
# NB: match on `Mapped {` alone. Nest colourises, so ANSI escapes sit between
# the `[RouterExplorer]` tag and the message and a combined pattern silently
# counts zero — which is indistinguishable from "did not boot".
ROUTES=$(grep -c "Mapped {" "$UP_LOG" 2>/dev/null) || ROUTES=0
if [ "$ROUTES" -lt 100 ]; then
	echo "----- boot log -----" >&2
	tail -60 "$UP_LOG" >&2
	fail "pl up mapped $ROUTES routes — it did not boot, so no HTTP assertion below means anything"
fi
echo "    mapped routes: $ROUTES"

grep -q "CORS enabled for origins" "$UP_LOG" && fail "the vestigial CORS allowlist is back — pl up is single-origin"

HTTP_PROBE_MJS="$PKG/prismalens-smoke-http-probe.mjs"
cat > "$HTTP_PROBE_MJS" <<'PROBE'
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveHarnessSelection } from "@prismalens/config/harness-selection";

const base = process.env.PRISMALENS_SMOKE_BASE;
const bootLog = process.argv[2];
// The Part A assertion sequence, shared with scripts/cross-os-app-boot.mjs
// (#551). This file lives inside the installed package so that the bare
// specifier above resolves, which puts the repo checkout out of relative reach —
// hence the absolute path handed in by the shell.
const { assertRefusalGate } = await import(
	pathToFileURL(process.argv[3]).href
);
const email = "smoke@prismalens.test";
const password = "smoke-password-12345";
let failed = 0;

const ok = (name, detail = "") => console.log(`    OK   ${name}${detail ? " — " + detail : ""}`);
const bad = (name, detail) => { failed++; console.error(`    FAIL ${name} — ${detail}`); };

// Better Auth rejects a state-changing request with no Origin
// (MISSING_OR_NULL_ORIGIN), which is its CSRF floor. A browser always sends
// one; a bare fetch does not, so the probe supplies it — same-origin, because
// that is the only origin `pl up` has.
const json = (path, init) =>
	fetch(base + path, {
		...init,
		headers: {
			"content-type": "application/json",
			origin: base,
			...(init?.headers ?? {}),
		},
	});


(async () => {
	// --- health ---------------------------------------------------------------
	const health = await fetch(base + "/health");
	health.status === 200 ? ok("/health 200") : bad("/health", `status ${health.status}`);

	// --- the site root is the DASHBOARD, not the API's service-info JSON -------
	// A controller route registered before the static middleware wins, so `/`
	// silently returned `{"name":"PrismaLens API",...}` and `pl up` looked broken
	// on the very first page a user opens.
	const root = await fetch(base + "/");
	const rootBody = await root.text();
	if (root.status === 200 && /<!DOCTYPE html>/i.test(rootBody)) {
		ok("/ serves the dashboard");
	} else {
		bad("/", `status ${root.status}, body starts "${rootBody.slice(0, 80)}"`);
	}
	// ...and the service info moved to /api rather than disappearing.
	const info = await fetch(base + "/api");
	info.status === 200 && (info.headers.get("content-type") ?? "").includes("json")
		? ok("/api still serves the service info")
		: bad("/api", `status ${info.status}`);

	// --- SPA deep route: a client-side path the API has no controller for ------
	const deep = await fetch(base + "/incidents/does-not-exist-in-any-router");
	const deepBody = await deep.text();
	if (deep.status === 200 && /<!DOCTYPE html>/i.test(deepBody)) {
		ok("SPA deep route 200 text/html", `${deepBody.length} bytes`);
	} else {
		bad("SPA deep route", `status ${deep.status}, body starts "${deepBody.slice(0, 60)}"`);
	}

	// --- the API's own 404 must NOT be swallowed by the SPA fallback -----------
	const missing = await fetch(base + "/api/nonexistent");
	const missingType = missing.headers.get("content-type") ?? "";
	if (missing.status === 404 && missingType.includes("application/json")) {
		ok("/api/nonexistent 404 JSON");
	} else {
		bad("/api/nonexistent", `status ${missing.status}, content-type ${missingType}`);
	}

	// --- docs and webhooks are excluded from the SPA fallback too --------------
	const docs = await fetch(base + "/api/docs");
	docs.status === 200 ? ok("/api/docs 200") : bad("/api/docs", `status ${docs.status}`);
	const webhook = await json("/api/webhooks/generic", { method: "POST", body: "{}" });
	webhook.status !== 200 || !/text\/html/.test(webhook.headers.get("content-type") ?? "")
		? ok("/api/webhooks/generic reaches Nest", `status ${webhook.status}`)
		: bad("/api/webhooks/generic", "the SPA fallback swallowed a webhook");

	// --- first-run: create the owner, then sign in ----------------------------
	const setup = await json("/api/setup", {
		method: "POST",
		body: JSON.stringify({ email, password, name: "Packed Smoke" }),
	});
	if (setup.status >= 200 && setup.status < 300) ok("POST /api/setup", `status ${setup.status}`);
	else bad("POST /api/setup", `status ${setup.status}: ${(await setup.text()).slice(0, 200)}`);

	const signIn = await json("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	const signInBody = await signIn.text();
	const setCookie = signIn.headers.getSetCookie?.() ?? [];
	const sessionCookie = setCookie.find((c) => /session/i.test(c));
	const hasToken = /"token"\s*:\s*"[^"]+"/.test(signInBody) || Boolean(sessionCookie);
	if (signIn.status === 200 && hasToken) {
		ok("POST /api/auth/sign-in/email 200 with a session token");
	} else {
		bad("sign-in", `status ${signIn.status}, cookies ${setCookie.length}, body ${signInBody.slice(0, 200)}`);
	}
	const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");

	// --- an authenticated call, i.e. the global APP_GUARD is satisfiable -------
	const incidents = await fetch(base + "/api/incidents", { headers: { cookie } });
	incidents.status === 200
		? ok("authenticated GET /api/incidents 200")
		: bad("authenticated GET /api/incidents", `status ${incidents.status}`);

	// --- unrunnable investigation refused server-side (#520) ------------------
	// Only the refusal: starting a run needs a harness binary on PATH, and this
	// gate asserts the opposite (a runnable machine fails its clean-machine
	// precondition), so both cannot share one `pl up`. The run path is covered
	// against real OpenCode by the `harness-admission` CI job.
	// The sequence itself lives in packages/@prismalens/engine/scripts/refusal-gate-check.mjs (#551);
	// what stays here is what is genuinely container-specific — a bare specifier
	// that resolves through the installed package, and a log that is a file.
	await assertRefusalGate({
		json,
		cookie,
		resolveExpected: () =>
			resolveHarnessSelection({ envHarness: process.env.PRISMALENS_HARNESS }),
		readLog: () => {
			try {
				return fs.readFileSync(bootLog, "utf8");
			} catch {
				return "";
			}
		},
		getLogOffset: () => {
			try {
				return fs.statSync(bootLog).size;
			} catch {
				return 0;
			}
		},
		ok,
		bad,
		incidentTitle: "packed smoke refusal probe",
	});

	if (failed > 0) process.exit(1);
})().catch((error) => {
	console.error(`    FAIL probe threw — ${error?.stack ?? error}`);
	process.exit(1);
});
PROBE
PRISMALENS_SMOKE_BASE="http://127.0.0.1:$PORT" node "$HTTP_PROBE_MJS" "$UP_LOG" "$REFUSAL_GATE_LIB" || {
	echo "----- pl up log -----" >&2
	tail -60 "$UP_LOG" >&2
	fail "the pl up HTTP contract is broken"
}
rm -f "$HTTP_PROBE_MJS"

stop_up

echo "SMOKE OK (node $(node --version))"
