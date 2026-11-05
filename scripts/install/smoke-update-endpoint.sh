#!/bin/sh
# Install and restart from the app (#724), end to end on an installer copy: this
# build runs, the host's session calls POST /api/settings/update/install, and
# /health then reports the next version. The next version is this archive
# relabelled one patch up, since a release older than this build has no endpoint.
# Usage: smoke-update-endpoint.sh <new-archive-dir> <new-version>
set -eu

new_dir=$1 new_version=$2
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
installer="$repo_root/scripts/install/install.sh"
work=$(mktemp -d)
clean_path="/usr/bin:/bin:/usr/sbin:/sbin"
port=3943
url="http://127.0.0.1:$port"
next=$(echo "$new_version" | awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 1 }')

fail() {
	echo "SMOKE FAIL: $*" >&2
	cat "$work/up.log" "$work/ws/logs/update-restart.log" 2>/dev/null >&2 || true
	exit 1
}
cleanup() {
	pkill -f "$work/home/.local/share/prismalens/runtime/" 2>/dev/null || true
	rm -rf "$work"
}
trap cleanup EXIT

# The release base URL holds this build and the relabelled next one.
base="$work/base"
archive=$(cd "$new_dir" && ls prismalens-"$new_version"-*.tar.gz | head -n 1)
target=${archive#prismalens-"$new_version"-}
target=${target%.tar.gz}
mkdir -p "$base/v$new_version" "$base/v$next" "$work/relabel"
cp "$new_dir/$archive" "$base/v$new_version/"
tar -xzf "$new_dir/$archive" -C "$work/relabel"
mv "$work/relabel/prismalens-$new_version-$target" "$work/relabel/prismalens-$next-$target"
pkg="$work/relabel/prismalens-$next-$target/app/package.json"
[ -f "$pkg" ] || fail "no app/package.json in the archive"
sed -i.bak "s/\"version\": \"$new_version\"/\"version\": \"$next\"/" "$pkg" && rm "$pkg.bak"
(cd "$work/relabel" && tar -czf "$base/v$next/prismalens-$next-$target.tar.gz" "prismalens-$next-$target")
for v in "$new_version" "$next"; do
	(cd "$base/v$v" && { sha256sum ./*.tar.gz 2>/dev/null || shasum -a 256 ./*.tar.gz; } | sed 's# \./# #' >SHA256SUMS)
done

mkdir -p "$work/home"
env -i HOME="$work/home" PATH="$clean_path" SHELL=/bin/bash PRISMALENS_RELEASE_BASE_URL="file://$base" \
	sh "$installer" --version "$new_version" --no-modify-path >/dev/null 2>&1 || fail "installing $new_version"
bin="$work/home/.local/bin"

# The day-long update cache already knows the next version, so nothing asks GitHub.
ws="$work/ws"
mkdir -p "$ws"
printf '{"checkedAt":%s000,"latest":"%s"}\n' "$(date +%s)" "$next" >"$ws/update-check.json"

env -i HOME="$work/home" PATH="$clean_path" CI=true \
	PRISMALENS_RELEASE_BASE_URL="file://$base" PRISMALENS_INSTALLER_SCRIPT="$installer" \
	PRISMALENS_TELEMETRY=off "$bin/pl" up --port "$port" --workspace "$ws" --no-open >"$work/up.log" 2>&1 &
old_pid=$!
i=0
until curl -sf "$url/health" >/dev/null 2>&1; do
	i=$((i + 1))
	[ $i -lt 90 ] || fail "$new_version pl up never answered"
	sleep 1
done

# The host's own session: an operator link from pl pair, redeemed like a browser does.
link=$(env -i HOME="$work/home" PATH="$clean_path" "$bin/pl" pair --operator --workspace "$ws" 2>&1 | grep -o 'https\?://[^ ]*' | head -n 1)
# The token is the link's whole fragment (buildPairingUrl).
token=${link#*#}
[ "$token" != "$link" ] || token=
[ -n "$token" ] || fail "no operator token in: $link"
cookie=$(curl -s -o /dev/null -D - -H "content-type: application/json" -H "origin: $url" \
	-d "{\"token\":\"$token\",\"name\":\"smoke\"}" "$url/api/pairing/redeem" |
	sed -n 's/^[Ss]et-[Cc]ookie: \(prismalens\.device\.[^;]*\).*/\1/p' | head -n 1)
[ -n "$cookie" ] || fail "pairing as the operator"

status=$(curl -s -o "$work/install.json" -w '%{http_code}' -H "cookie: $cookie" -H "content-type: application/json" \
	-H "origin: $url" -d "{\"version\":\"$next\"}" "$url/api/settings/update/install")
[ "$status" = 202 ] || { cat "$work/install.json" >&2; fail "install answered $status"; }

i=0
until [ "$(curl -sf "$url/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" = "$next" ]; do
	i=$((i + 1))
	[ $i -lt 240 ] || fail "/health never reported $next"
	sleep 1
done
! kill -0 "$old_pid" 2>/dev/null || fail "the $new_version process is still running"
grep -q '"result":"done"' "$ws/update-result.json" || fail "the handoff recorded no success"
[ "$(env -i PATH="$clean_path" "$bin/pl" --version)" = "$next" ] || fail "pl --version after the restart"
echo "ok - Install and restart: $new_version → $next from the endpoint, /health reports $next"
