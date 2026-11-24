#!/bin/sh
# PrismaLens installer for macOS and Linux (#717): a release archive with its own
# Node, checked against SHA256SUMS. `sh install.sh --help` lists the options.
set -eu

repo="prismalens/prismalens"
api="https://api.github.com/repos/${repo}"
# Archives: mirror first (it keeps the newest releases only), GitHub second; a set base is the only one.
# SHA256SUMS: from the last base only (GitHub, or the set one), so a mirror can't vouch for its own bytes.
mirror_base="https://downloads.prismalens.io"
github_base="https://github.com/prismalens/prismalens/releases/download"
if [ -n "${PRISMALENS_RELEASE_BASE_URL:-}" ]; then
	bases="${PRISMALENS_RELEASE_BASE_URL%/}"
else
	bases="$mirror_base $github_base"
fi
sums_base=${bases##* }
data_root="${PRISMALENS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/prismalens}"
runtime_root="${data_root}/runtime"
receipt="${data_root}/receipt"
bin_dir="${PRISMALENS_INSTALL_BIN_DIR:-$HOME/.local/bin}"
marker="# Added by the PrismaLens installer"
version="${PRISMALENS_VERSION:-}"
modify_path=true
[ "${PRISMALENS_NO_MODIFY_PATH:-}" = 1 ] && modify_path=false
action=install

usage() {
	cat <<'EOF'
Install PrismaLens without Node.

  curl -fsSL https://prismalens.io/install.sh | sh
  curl -fsSL https://prismalens.io/install.sh | sh -s -- --version 0.5.1
  curl -fsSL https://prismalens.io/install.sh | sh -s -- --uninstall

Options:
  --version <v>       Install this version instead of the newest.
  --no-modify-path    Don't add the bin directory to your shell's rc file.
  --uninstall         Remove the runtime, the pl wrappers and the PATH line.
                      Your workspace (~/.prismalens) is kept.
  -h, --help          Show this.

Environment:
  PRISMALENS_VERSION, PRISMALENS_NO_MODIFY_PATH=1   Same as the flags.
  PRISMALENS_ALLOW_DOWNGRADE=1   Allow an older version than the one installed.
  PRISMALENS_HOME                Where the runtime and receipt go (default ~/.local/share/prismalens).
  PRISMALENS_INSTALL_BIN_DIR     Where pl goes (default ~/.local/bin).
  PRISMALENS_RELEASE_BASE_URL    Download only from this base, as <base>/v<version>/<file>.
                                 Default: archives from downloads.prismalens.io, then GitHub releases;
                                 SHA256SUMS always from GitHub (or that base).
  NO_COLOR                       Plain output.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--version)
		[ $# -ge 2 ] || { usage >&2; exit 2; }
		version=$2
		shift 2
		;;
	--version=*) version=${1#*=}; shift ;;
	--no-modify-path) modify_path=false; shift ;;
	--uninstall) action=uninstall; shift ;;
	-y | --yes) shift ;;
	-h | --help) usage; exit 0 ;;
	*) usage >&2; exit 2 ;;
	esac
done
version=${version#v}

# --- output -----------------------------------------------------------------

fancy=false
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ -z "${CI:-}" ] && [ "${TERM:-}" != dumb ]; then
	fancy=true
fi
if "$fancy"; then
	e=$(printf '\033')
	r="${e}[0m" bold="${e}[1m" dim="${e}[2m"
	ink="${e}[38;2;226;232;240m" beam="${e}[38;2;148;163;184m"
	sky="${e}[38;2;56;189;248m" ind="${e}[38;2;99;102;241m" vio="${e}[38;2;139;92;246m"
	ok="${e}[38;2;52;211;153m" warn_c="${e}[38;2;251;191;36m" err_c="${e}[38;2;248;113;113m"
else
	r='' bold='' dim='' ink='' beam='' sky='' ind='' vio='' ok='' warn_c='' err_c=''
fi

banner() {
	"$fancy" || return 0
	printf '%s\n' \
		"" \
		"               ${ink}╱╲${r}" \
		"              ${ink}╱  ╲${r}            ${sky}▂▄▆${r}" \
		"             ${ink}╱    ╲${r}      ${sky}▂▄▆▀▀${r}" \
		"  ${beam}━━━━━━━━━━${ink}╱${r}      ${ink}╲${ind}━━━━━━━━━━━━━${r}" \
		"           ${ink}╱        ╲${r}    ${vio}▀▀▆▄▂${r}" \
		"          ${ink}╱──────────╲${r}        ${vio}▀▆▄▂${r}" \
		"" \
		"   ${bold}${ind}Prisma${ink}Lens${r}  ${dim}$1${r}" \
		"   ${dim}AI root-cause investigation, in your terminal${r}" \
		"" >&2
}
step() { printf '  %s•%s %s\n' "$dim" "$r" "$1" >&2; }
done_() { printf '  %s✔%s %s\n' "$ok" "$r" "$1" >&2; }
warn() { printf '  %s!%s %s\n' "$warn_c" "$r" "$1" >&2; }
fail() {
	printf '  %s✘%s %s\n' "$err_c" "$r" "$1" >&2
	exit 1
}

# --- helpers ----------------------------------------------------------------

# fetch <url> <file> [progress]: a progress bar only when asked and stderr is a terminal.
# ${stall} seconds without a byte aborts it, so a silent mirror can't hold the install.
fetch() {
	speed=
	[ -z "${stall:-}" ] || speed="--speed-limit 1024 --speed-time $stall"
	case "$1" in
	file://*)
		[ -f "${1#file://}" ] || return 1
		cp "${1#file://}" "$2"
		return 0
		;;
	esac
	if command -v curl >/dev/null 2>&1; then
		if [ "${3:-}" = progress ] && [ -t 2 ]; then
			curl -fL --retry 2 --connect-timeout 20 $speed --progress-bar "$1" -o "$2" || { rm -f "$2"; return 1; }
		else
			curl -fsSL --retry 2 --connect-timeout 20 $speed "$1" -o "$2" 2>/dev/null
		fi
	elif command -v wget >/dev/null 2>&1; then
		wget -q ${stall:+--read-timeout="$stall"} "$1" -O "$2"
	else
		fail "curl or wget is required"
	fi
}

# The size of <url> in bytes, or nothing when the server doesn't say.
remote_size() {
	case "$1" in file://*) return 0 ;; esac
	command -v curl >/dev/null 2>&1 || return 0
	curl -sIL --connect-timeout 20 --max-time 20 "$1" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { if (n) print n }'
}

host_of() {
	case "$1" in
	file://*) echo disk ;;
	*) echo "${1#*://}" | cut -d/ -f1 ;;
	esac
}

hosts_tried() {
	out=
	for b in $bases; do out="${out:+$out, }$(host_of "$b")"; done
	echo "$out"
}

# Fetches v<version>/SHA256SUMS from sums_base, the only place checksums come from.
fetch_sums() {
	fetch "$sums_base/v$1/SHA256SUMS" "$2"
}

checksum() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		fail "sha256sum or shasum is required"
	fi
}

# 0 when $1 is an older x.y.z than $2.
older() {
	[ "$1" = "$2" ] && return 1
	lower=$(printf '%s\n%s\n' "$1" "$2" | awk -F. '{ printf "%09d%09d%09d %s\n", $1, $2, $3, $0 }' | sort | head -n 1 | cut -d' ' -f2)
	[ "$lower" = "$1" ]
}

size_mb() { awk -v b="$(wc -c <"$1")" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

receipt_get() { sed -n "s/^$1=//p" "$receipt" 2>/dev/null | head -n 1; }

rc_file() {
	case "${SHELL:-}" in
	*/zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
	*/fish) echo "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/prismalens.fish" ;;
	*/bash) if [ "$(uname -s)" = Darwin ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.bashrc"; fi ;;
	*) echo "$HOME/.profile" ;;
	esac
}

# Every pl on PATH that isn't a wrapper this installer wrote.
other_pls() {
	old_ifs=$IFS
	IFS=:
	for dir in $PATH; do
		[ -n "$dir" ] && [ -x "$dir/pl" ] || continue
		grep -q "$marker" "$dir/pl" 2>/dev/null && continue
		echo "$dir/pl"
	done
	IFS=$old_ifs
}

# --- uninstall --------------------------------------------------------------

if [ "$action" = uninstall ]; then
	banner uninstaller
	installed_bin=$(receipt_get bin_dir)
	dir="${installed_bin:-$bin_dir}"
	# The background service runs this install's pl; remove it before pl goes (#732).
	if [ -f "$dir/pl" ] && { [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/prismalens.service" ] || [ -f "$HOME/Library/LaunchAgents/io.prismalens.server.plist" ]; }; then
		"$dir/pl" service uninstall >/dev/null 2>&1 && done_ "Removed the background service"
	fi
	for name in pl prismalens; do
		if [ -f "$dir/$name" ] && grep -q "$marker" "$dir/$name"; then
			rm -f "$dir/$name"
			done_ "Removed $dir/$name"
		fi
	done
	rc=$(receipt_get rc)
	if [ -n "$rc" ] && [ -f "$rc" ] && grep -q "$marker" "$rc"; then
		case "$rc" in
		*.fish) rm -f "$rc" ;;
		*)
			tmp=$(mktemp)
			awk -v m="$marker" '$0 == m { skip = 1; next } skip { skip = 0; next } { print }' "$rc" >"$tmp"
			cat "$tmp" >"$rc"
			rm -f "$tmp"
			;;
		esac
		done_ "Removed the PATH line from $rc"
	fi
	if [ -d "$data_root" ]; then
		rm -rf "$data_root"
		done_ "Removed $data_root"
	fi
	[ -n "$installed_bin$rc" ] || [ -d "$data_root" ] || warn "Nothing installed by this installer was found."
	printf '\n  Your workspace is kept: %s\n  To delete it as well, run %spl reset%s first, or remove that folder.\n\n' \
		"${PRISMALENS_WORKSPACE_DIR:-$HOME/.prismalens}" "$bold" "$r" >&2
	exit 0
fi

# --- install ----------------------------------------------------------------

banner installer

case "$(uname -s)" in
Darwin) platform=darwin ;;
Linux) platform=linux ;;
*) fail "$(uname -s) isn't supported by this installer; use npm install -g prismalens" ;;
esac
case "$(uname -m)" in
arm64 | aarch64) arch=arm64 ;;
x86_64 | amd64) arch=x64 ;;
*) fail "$(uname -m) isn't supported by this installer; use npm install -g prismalens" ;;
esac
target="${platform}-${arch}"
command -v tar >/dev/null 2>&1 || fail "tar is required"

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT INT TERM

# The newest release with its archives attached. build-standalone-cli.yml builds them for
# about 20 minutes after a release publishes, so fall back to the one before.
# 30 releases, because up to 10 nightly prereleases sit among them (nightly.yml prunes the rest).
if [ -n "$version" ]; then
	fetch_sums "$version" "$staging/SHA256SUMS" || fail "Couldn't fetch SHA256SUMS for ${version} from $(host_of "$sums_base"), the only source of checksums, so nothing was installed. Check the version and your connection."
else
	step "Finding the newest release"
	fetch "${api}/releases?per_page=30" "$staging/releases.json" || fail "Couldn't reach GitHub. Pass --version to install a known version."
	# The API returns one line of JSON: split it per field so every tag is seen,
	# newest first. Plain x.y.z only, which also skips pre-releases.
	tags=$(tr ',{' '\n\n' <"$staging/releases.json" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"v\{0,1\}\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)"[]}[:space:]]*$/\1/p')
	newest=
	for tag in $tags; do
		[ -n "$newest" ] || newest=$tag
		if fetch_sums "$tag" "$staging/SHA256SUMS"; then
			version=$tag
			break
		fi
	done
	[ -n "$version" ] || fail "No release has installer archives yet; use npm install -g prismalens"
	[ "$version" = "$newest" ] || warn "${newest} is still being built, so this installs ${version}. Run the installer again in a few minutes for ${newest}."
fi

installed=$(receipt_get version)
if [ -n "$installed" ] && older "$version" "$installed"; then
	warn "${version} is older than the ${installed} installed."
	warn "A workspace ${installed} has migrated won't open in ${version}: pl up stops with"
	warn "\"migrations this build does not ship\". To go back, restore the prismalens.db.bak-*"
	warn "file ${installed} left in your workspace before migrating."
	[ "${PRISMALENS_ALLOW_DOWNGRADE:-}" = 1 ] || fail "Set PRISMALENS_ALLOW_DOWNGRADE=1 to install ${version} anyway."
fi

archive="prismalens-${version}-${target}.tar.gz"
# The checksum is the release's own; the archive may come from any base and is verified against it.
expected=$(grep -E "(^|[[:space:]]|\*)${archive}\$" "$staging/SHA256SUMS" | cut -d' ' -f1 | head -n 1)
[ -n "$expected" ] || fail "${archive} isn't listed in SHA256SUMS on $(host_of "$sums_base"); nothing was installed."
tried=
verified=false
stall=
for b in $bases; do
	"$verified" && break
	h=$(host_of "$b")
	# A base with a successor is dropped after 30 s without a byte.
	if [ "$b" = "$sums_base" ]; then stall=; else stall=30; fi
	url="$b/v${version}/${archive}"
	bytes=$(remote_size "$url")
	size=
	[ -z "$bytes" ] || size=$(awk -v b="$bytes" 'BEGIN { printf " (%.0f MB)", b / 1048576 }')
	step "Downloading PrismaLens ${version} for ${target}${size} from ${h}"
	fetch "$url" "$staging/$archive" progress || { tried="${tried:+$tried; }${h}: download failed"; continue; }
	step "Verifying $(size_mb "$staging/$archive") against SHA256SUMS from $(host_of "$sums_base")"
	[ "$(checksum "$staging/$archive")" = "$expected" ] || { tried="${tried:+$tried; }${h}: Checksum mismatch"; continue; }
	verified=true
done
"$verified" || fail "Couldn't install ${archive} from $(hosts_tried); nothing was installed. ${tried}"

step "Installing to ${runtime_root}/${version}"
tar -xzf "$staging/$archive" -C "$staging"
[ -d "$staging/prismalens-${version}-${target}" ] || fail "Unexpected archive layout"
mkdir -p "$runtime_root"
rm -rf "${runtime_root:?}/${version}.new"
mv "$staging/prismalens-${version}-${target}" "$runtime_root/${version}.new"
rm -rf "${runtime_root:?}/${version}"
mv "$runtime_root/${version}.new" "$runtime_root/${version}"

mkdir -p "$bin_dir"
for name in pl prismalens; do
	cat >"$bin_dir/$name" <<EOF
#!/bin/sh
$marker
exec "$runtime_root/$version/bin/$name" "\$@"
EOF
	chmod 755 "$bin_dir/$name"
done

# Keep this version and the one it replaced, for rollback.
for dir in "$runtime_root"/*; do
	[ -d "$dir" ] || continue
	v=${dir##*/}
	[ "$v" = "$version" ] || [ "$v" = "$installed" ] || rm -rf "$dir"
done

rc=$(receipt_get rc)
case ":$PATH:" in
*":$bin_dir:"*) ;;
*)
	if ! "$modify_path"; then
		warn "$bin_dir isn't on your PATH; add it to run pl."
	else
		rc=$(rc_file)
		if ! grep -q "$marker" "$rc" 2>/dev/null; then
			mkdir -p "$(dirname "$rc")"
			case "$rc" in
			*.fish) printf '%s\nfish_add_path "%s"\n' "$marker" "$bin_dir" >>"$rc" ;;
			*) printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$bin_dir" >>"$rc" ;;
			esac
			done_ "Added $bin_dir to your PATH in $rc"
		fi
		warn "Open a new terminal, or run: export PATH=\"$bin_dir:\$PATH\""
	fi
	;;
esac

cat >"$receipt" <<EOF
version=$version
channel=installer
target=$target
bin_dir=$bin_dir
rc=$rc
installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

others=$(other_pls)
if [ -n "$others" ]; then
	warn "Another PrismaLens is on your PATH:"
	for p in $others; do warn "  $p ($("$p" --version 2>/dev/null || echo "version unknown"))"; done
	warn "They share one workspace, and an older one stops once a newer one has migrated it."
	warn "Remove the other one (npm uninstall -g prismalens, brew uninstall prismalens) or keep both on one version."
fi

done_ "PrismaLens $("$bin_dir/pl" --version) installed"
printf '\n  Start it with %spl up%s   ·   Upgrade with %spl upgrade%s   ·   Docs: https://docs.prismalens.io\n\n' \
	"$bold" "$r" "$bold" "$r" >&2
