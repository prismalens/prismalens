#!/bin/sh
# End-to-end check of install.sh against local archives (#717): install, PATH,
# reinstall, downgrade guard, upgrade from an older build with data, uninstall.
# Usage: smoke-installer.sh <new-archive-dir> <new-version> [<old-archive-dir> <old-version>]
set -eu

new_dir=$1 new_version=$2 old_dir=${3:-} old_version=${4:-}
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
installer="$repo_root/scripts/install/install.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
clean_path="/usr/bin:/bin:/usr/sbin:/sbin"
port=3942

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }

# A release-shaped base URL, <base>/v<version>/{archive,SHA256SUMS}; old and new
# can share a version number before the release bumps it, hence the label.
stage() {
	base="$work/base-$3"
	mkdir -p "$base/v$2"
	cp "$1"/prismalens-"$2"-*.tar.gz "$base/v$2/"
	(cd "$base/v$2" && { sha256sum ./*.tar.gz 2>/dev/null || shasum -a 256 ./*.tar.gz; } | sed 's# \./# #' >SHA256SUMS)
	echo "file://$base"
}

# Runs the installer as a fresh user: its own HOME, bash as the login shell.
run_installer() {
	r_base=$1
	shift
	env -i HOME="$work/home" PATH="$clean_path" SHELL=/bin/bash \
		PRISMALENS_RELEASE_BASE_URL="$r_base" sh "$installer" "$@"
}

# POSIX sh has no `local`: the names are prefixed so they can't clobber callers'.
health() {
	h_ws=$1 h_pl=$2
	env -i HOME="$work/home" PATH="$clean_path" CI=true "$h_pl" up --port "$port" --workspace "$h_ws" >"$work/up.log" 2>&1 &
	pid=$!
	i=0
	while [ $i -lt 90 ]; do
		if curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
			kill "$pid" 2>/dev/null || true
			wait "$pid" 2>/dev/null || true
			return 0
		fi
		kill -0 "$pid" 2>/dev/null || break
		sleep 1
		i=$((i + 1))
	done
	kill -9 "$pid" 2>/dev/null || true
	cat "$work/up.log" >&2
	return 1
}

# Runs SQL against the workspace database with the installed runtime's own
# node and better-sqlite3: `sql <version> <workspace> <statement>` prints one value.
sql() {
	c_rt="$work/home/.local/share/prismalens/runtime/$1"
	"$c_rt/node/bin/node" -e "
		const Database = require(require.resolve('better-sqlite3', { paths: ['$c_rt/app'] }));
		const db = new Database(process.argv[1]);
		const stmt = db.prepare(process.argv[2]);
		console.log(stmt.reader ? Object.values(stmt.get() ?? { v: '' })[0] : stmt.run().changes);
	" "$2/prismalens.db" "$3"
}

# `pl upgrade` run from the old install, as a person runs it (#920): `upgrade_with_pl <old> <new> <base>`.
# Its two reads of the network are redirected: prismalens.io/install.sh is this checkout's installer, and
# the release check answers for the staged archive. A release whose pl has no `upgrade` is moved by the installer.
upgrade_with_pl() {
	u_shim="$work/shim"
	mkdir -p "$u_shim"
	printf '#!/bin/sh\ncase "$*" in\n*https://prismalens.io/install.sh*) cat "%s" ;;\n*) exec "%s" "$@" ;;\nesac\n' \
		"$installer" "$(command -v curl)" >"$u_shim/curl"
	chmod 755 "$u_shim/curl"
	cat >"$work/ready.mjs" <<'JS'
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
	if (init?.method === "HEAD" && /\/releases\/download\/v[^/]+\/SHA256SUMS$/.test(url))
		return Promise.resolve(new Response(null, { status: 200 }));
	return real(input, init);
};
JS
	if u_out=$(env -i HOME="$work/home" PATH="$u_shim:$bin:$clean_path" SHELL=/bin/bash \
		PRISMALENS_RELEASE_BASE_URL="$3" PRISMALENS_UPDATE_CHECK=off PRISMALENS_TELEMETRY=off \
		NODE_OPTIONS="--import=file://$work/ready.mjs" "$bin/pl" upgrade --version "$2" 2>&1); then
		return 0
	fi
	case "$u_out" in
	*[Uu]nknown\ command*)
		echo "note: $1 has no pl upgrade; the installer moves it"
		run_installer "$3" --version "$2" --no-modify-path >/dev/null 2>&1
		;;
	*)
		echo "$u_out" >&2
		return 1
		;;
	esac
}

mkdir -p "$work/home"
bin="$work/home/.local/bin"
# The installer picks bash's rc file per OS: macOS terminals start login shells.
if [ "$(uname -s)" = Darwin ]; then rc="$work/home/.bash_profile"; else rc="$work/home/.bashrc"; fi
new_base=$(stage "$new_dir" "$new_version" new)

# 1. Upgrade from an older build, with its data (only when one is given).
if [ -n "$old_dir" ]; then
	old_base=$(stage "$old_dir" "$old_version" old)
	run_installer "$old_base" --version "$old_version" --no-modify-path >/dev/null 2>&1 || fail "installing $old_version"
	ws="$work/workspace"
	health "$ws" "$bin/pl" || fail "$old_version pl up"
	migrations_before=$(sql "$old_version" "$ws" "select count(*) from _prisma_migrations")
	sql "$old_version" "$ws" "insert into settings (id, key, value, updatedAt) values ('smoke', 'SMOKE_MARKER', '\"kept\"', CURRENT_TIMESTAMP)" >/dev/null
	upgrade_with_pl "$old_version" "$new_version" "$new_base" || fail "upgrading $old_version to $new_version with pl upgrade"
	[ "$(env -i PATH="$clean_path" "$bin/pl" --version)" = "$new_version" ] || fail "pl --version after upgrading from $old_version"
	health "$ws" "$bin/pl" || fail "$new_version pl up on the $old_version workspace"
	migrations_after=$(sql "$new_version" "$ws" "select count(*) from _prisma_migrations")
	marker=$(sql "$new_version" "$ws" "select value from settings where key = 'SMOKE_MARKER'")
	[ "$migrations_after" -ge "$migrations_before" ] || fail "migrations went from $migrations_before to $migrations_after"
	[ "$marker" = '"kept"' ] || fail "a row written by $old_version was lost (got '$marker')"
	pass "pl upgrade $old_version → $new_version: pl up healthy, migrations $migrations_before → $migrations_after, a row written by $old_version kept"
	rm -rf "$work/home"
	mkdir -p "$work/home"
fi

# 2. Fresh install puts pl on PATH through the rc file and writes a receipt.
out=$(run_installer "$new_base" --version "$new_version" 2>&1) || { echo "$out"; fail "fresh install"; }
[ "$(env -i PATH="$clean_path" "$bin/pl" --version)" = "$new_version" ] || fail "pl --version"
grep -q "Added by the PrismaLens installer" "$rc" || fail "no PATH line in $rc"
grep -q "^version=$new_version$" "$work/home/.local/share/prismalens/receipt" || fail "receipt"
pass "fresh install: pl $new_version, PATH line in ${rc##*/}, receipt written"

# 3. Reinstalling doesn't add a second PATH line.
run_installer "$new_base" --version "$new_version" >/dev/null 2>&1 || fail "reinstall"
[ "$(grep -c "Added by the PrismaLens installer" "$rc")" = 1 ] || fail "PATH line duplicated"
pass "reinstall: one PATH line"

# 4. An older version than the receipt's is refused without PRISMALENS_ALLOW_DOWNGRADE.
sed -i.bak "s/^version=.*/version=99.0.0/" "$work/home/.local/share/prismalens/receipt"
if run_installer "$new_base" --version "$new_version" >"$work/down.log" 2>&1; then
	fail "downgrade from 99.0.0 was not refused"
fi
grep -q "PRISMALENS_ALLOW_DOWNGRADE" "$work/down.log" || fail "downgrade refusal doesn't name the override"
pass "downgrade guard"
sed -i.bak "s/^version=.*/version=$new_version/" "$work/home/.local/share/prismalens/receipt"

# 5. Another pl on PATH is reported.
mkdir -p "$work/other"
printf '#!/bin/sh\necho 0.0.1\n' >"$work/other/pl"
chmod 755 "$work/other/pl"
env -i HOME="$work/home" PATH="$work/other:$clean_path" SHELL=/bin/bash PRISMALENS_RELEASE_BASE_URL="$new_base" \
	sh "$installer" --version "$new_version" >"$work/other.log" 2>&1 || fail "install with another pl"
grep -q "Another PrismaLens is on your PATH" "$work/other.log" || fail "second pl not reported"
pass "second pl on PATH reported"

# 6. Uninstall removes the wrappers, the PATH line and the runtime; the workspace stays.
mkdir -p "$work/home/.prismalens"
touch "$work/home/.prismalens/prismalens.db"
run_installer "$new_base" --uninstall >/dev/null 2>&1 || fail "uninstall"
[ ! -e "$bin/pl" ] || fail "pl wrapper left behind"
! grep -q "Added by the PrismaLens installer" "$rc" || fail "PATH line left behind"
[ ! -d "$work/home/.local/share/prismalens" ] || fail "runtime left behind"
[ -f "$work/home/.prismalens/prismalens.db" ] || fail "uninstall touched the workspace"
pass "uninstall: wrappers, PATH line and runtime gone, workspace kept"

# 7. The desktop app, where a release builds one: installed with its launcher in the OS's usual place,
# skipped without a display or when asked, removed on uninstall. A stand-in app keeps this fast;
# build-desktop-app.yml opens the real one through its launcher.
case "$(uname -s)-$(uname -m)" in
Darwin-arm64) app_zip=PrismaLens-macOS-ARM64-unsigned.zip ;;
Linux-x86_64) app_zip=PrismaLens-Linux-X64-unsigned.zip ;;
*) app_zip= ;;
esac
if [ -z "$app_zip" ]; then
	echo "note: no desktop app is built for $(uname -s)-$(uname -m); section 7 skipped"
	exit 0
fi
app_base_dir="$work/base-app/v$new_version"
mkdir -p "$app_base_dir" "$work/fake-app"
cp "$new_dir"/prismalens-"$new_version"-*.tar.gz "$app_base_dir/"
if [ "$(uname -s)" = Darwin ]; then
	mkdir -p "$work/fake-app/mac-arm64/PrismaLens.app/Contents/MacOS"
	printf '#!/bin/sh\necho stand-in app\n' >"$work/fake-app/mac-arm64/PrismaLens.app/Contents/MacOS/PrismaLens"
	chmod 755 "$work/fake-app/mac-arm64/PrismaLens.app/Contents/MacOS/PrismaLens"
	(cd "$work/fake-app" && ditto -c -k --keepParent mac-arm64 "$app_base_dir/$app_zip")
else
	mkdir -p "$work/fake-app/linux-unpacked/resources"
	printf '#!/bin/sh\necho stand-in app\n' >"$work/fake-app/linux-unpacked/prismalens"
	chmod 755 "$work/fake-app/linux-unpacked/prismalens"
	printf 'png' >"$work/fake-app/linux-unpacked/resources/icon.png"
	(cd "$work/fake-app" && zip -qry "$app_base_dir/$app_zip" linux-unpacked)
fi
(cd "$app_base_dir" && { sha256sum ./* 2>/dev/null || shasum -a 256 ./*; } | sed 's# \./# #' >SHA256SUMS)
app_base="file://$work/base-app"
# A fresh user with a display: DISPLAY is all the installer looks at.
run_app_installer() {
	env -i HOME="$work/home" PATH="$clean_path" SHELL=/bin/bash DISPLAY=:99 \
		PRISMALENS_RELEASE_BASE_URL="$app_base" sh "$installer" --version "$new_version" --no-modify-path "$@"
}
rm -rf "$work/home" && mkdir -p "$work/home"
entry="$work/home/.local/share/applications/prismalens.desktop"
mac_app="$work/home/Applications/PrismaLens.app"

out=$(run_app_installer 2>&1) || { echo "$out"; fail "install with the desktop app"; }
grep -q "^desktop=1$" "$work/home/.local/share/prismalens/receipt" || fail "receipt has no desktop=1"
if [ "$(uname -s)" = Darwin ]; then
	[ "$("$mac_app/Contents/MacOS/PrismaLens")" = "stand-in app" ] || fail "no runnable $mac_app"
	case "$out" in *"Open the desktop app from Launchpad or Spotlight: PrismaLens ($mac_app)"*) ;; *) echo "$out"; fail "the final message doesn't say where the app is" ;; esac
	# curl, unlike a browser, sets no quarantine flag; the installer neither adds nor strips one.
	if xattr -p com.apple.quarantine "$mac_app" >/dev/null 2>&1; then fail "$mac_app is quarantined"; fi
	pass "desktop app: $mac_app runs, the final message names it, no quarantine flag"
else
	app="$work/home/.local/share/prismalens/desktop/app"
	grep -qx "Exec=\"$app/prismalens\"" "$entry" || { cat "$entry"; fail "the desktop entry doesn't run $app/prismalens"; }
	grep -qx "Icon=$app/resources/icon.png" "$entry" || { cat "$entry"; fail "the desktop entry has no icon"; }
	grep -qx "Type=Application" "$entry" || fail "the desktop entry has no Type"
	[ "$("$app/prismalens")" = "stand-in app" ] || fail "the entry's Exec target doesn't run"
	case "$out" in *"Open the desktop app from your app menu: PrismaLens ($entry)"*) ;; *) echo "$out"; fail "the final message doesn't say where the entry is" ;; esac
	pass "desktop app: $entry runs $app/prismalens with its icon, and the final message names it"

	rm -rf "$work/home" && mkdir -p "$work/home"
	out=$(env -i HOME="$work/home" PATH="$clean_path" SHELL=/bin/bash PRISMALENS_RELEASE_BASE_URL="$app_base" \
		sh "$installer" --version "$new_version" --no-modify-path 2>&1) || { echo "$out"; fail "install without a display"; }
	case "$out" in *"Desktop app skipped: no display (DISPLAY and WAYLAND_DISPLAY are unset)"*) ;; *) echo "$out"; fail "no display wasn't detected" ;; esac
	[ ! -e "$entry" ] || fail "a desktop entry was written without a display"
	pass "no display: the app is skipped by itself"
fi

run_app_installer >/dev/null 2>&1 || fail "reinstall with the desktop app"
run_installer "$app_base" --uninstall >/dev/null 2>&1 || fail "uninstall with the desktop app"
[ ! -e "$entry" ] || fail "uninstall left $entry"
[ ! -e "$mac_app" ] || fail "uninstall left $mac_app"
[ ! -d "$work/home/.local/share/prismalens" ] || fail "uninstall left the app's data"
pass "uninstall: the app and its launcher gone"

out=$(run_app_installer --no-desktop 2>&1) || { echo "$out"; fail "install with --no-desktop"; }
case "$out" in *"Desktop app skipped: you asked for the CLI only"*) ;; *) echo "$out"; fail "--no-desktop wasn't honoured" ;; esac
[ ! -e "$entry" ] && [ ! -e "$mac_app" ] || fail "--no-desktop still installed the app"
out=$(run_app_installer 2>&1) || fail "reinstall after --no-desktop"
case "$out" in *"an earlier install left it out"*) ;; *) echo "$out"; fail "a later install dropped the opt-out" ;; esac
pass "--no-desktop: no app, and a later install keeps it out"
