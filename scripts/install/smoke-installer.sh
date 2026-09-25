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
	base=$1
	shift
	env -i HOME="$work/home" PATH="$clean_path" SHELL=/bin/bash \
		PRISMALENS_RELEASE_BASE_URL="$base" sh "$installer" "$@"
}

health() {
	ws=$1 bin=$2
	env -i HOME="$work/home" PATH="$clean_path" CI=true "$bin" up --port "$port" --workspace "$ws" >"$work/up.log" 2>&1 &
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

# Rows in a table of the workspace database, read with the installed runtime.
count() {
	rt="$work/home/.local/share/prismalens/runtime/$1"
	"$rt/node/bin/node" -e "
		const Database = require(require.resolve('better-sqlite3', { paths: ['$rt/lib/node_modules/prismalens'] }));
		const db = new Database(process.argv[1], { readonly: true });
		console.log(db.prepare('select count(*) as n from ' + process.argv[2]).get().n);
	" "$2/prismalens.db" "$3"
}

mkdir -p "$work/home"
bin="$work/home/.local/bin"
new_base=$(stage "$new_dir" "$new_version" new)

# 1. Upgrade from an older build, with its data (only when one is given).
if [ -n "$old_dir" ]; then
	old_base=$(stage "$old_dir" "$old_version" old)
	run_installer "$old_base" --version "$old_version" --no-modify-path >/dev/null 2>&1 || fail "installing $old_version"
	ws="$work/workspace"
	health "$ws" "$bin/pl" || fail "$old_version pl up"
	migrations_before=$(count "$old_version" "$ws" _prisma_migrations)
	settings_before=$(count "$old_version" "$ws" settings)
	run_installer "$new_base" --version "$new_version" --no-modify-path >/dev/null 2>&1 || fail "upgrading to $new_version"
	health "$ws" "$bin/pl" || fail "$new_version pl up on the $old_version workspace"
	migrations_after=$(count "$new_version" "$ws" _prisma_migrations)
	settings_after=$(count "$new_version" "$ws" settings)
	[ "$migrations_after" -ge "$migrations_before" ] || fail "migrations went from $migrations_before to $migrations_after"
	[ "$settings_after" -ge "$settings_before" ] || fail "settings rows went from $settings_before to $settings_after"
	pass "upgrade $old_version → $new_version: pl up healthy, migrations $migrations_before → $migrations_after, settings kept ($settings_after)"
	rm -rf "$work/home"
	mkdir -p "$work/home"
fi

# 2. Fresh install puts pl on PATH through ~/.bashrc and writes a receipt.
out=$(run_installer "$new_base" --version "$new_version" 2>&1) || { echo "$out"; fail "fresh install"; }
[ "$(env -i PATH="$clean_path" "$bin/pl" --version)" = "$new_version" ] || fail "pl --version"
grep -q "Added by the PrismaLens installer" "$work/home/.bashrc" || fail "no PATH line in .bashrc"
grep -q "^version=$new_version$" "$work/home/.local/share/prismalens/receipt" || fail "receipt"
pass "fresh install: pl $new_version, PATH line in .bashrc, receipt written"

# 3. Reinstalling doesn't add a second PATH line.
run_installer "$new_base" --version "$new_version" >/dev/null 2>&1 || fail "reinstall"
[ "$(grep -c "Added by the PrismaLens installer" "$work/home/.bashrc")" = 1 ] || fail "PATH line duplicated"
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
! grep -q "Added by the PrismaLens installer" "$work/home/.bashrc" || fail "PATH line left behind"
[ ! -d "$work/home/.local/share/prismalens" ] || fail "runtime left behind"
[ -f "$work/home/.prismalens/prismalens.db" ] || fail "uninstall touched the workspace"
pass "uninstall: wrappers, PATH line and runtime gone, workspace kept"
