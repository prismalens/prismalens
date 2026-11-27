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
want_desktop="${PRISMALENS_DESKTOP:-}"
xdg_data="${XDG_DATA_HOME:-$HOME/.local/share}"
desktop_file="$xdg_data/applications/prismalens.desktop"
mac_app="$HOME/Applications/PrismaLens.app"
desktop_marker="X-PrismaLens-Installer=true"
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
  --no-desktop        Install the CLI only, without the desktop app and its launcher.
                      Skipped by itself without a display (DISPLAY, WAYLAND_DISPLAY) and in CI.
  --uninstall         Remove the runtime, the desktop app, the pl wrappers, the launcher
                      and the PATH line. Your workspace (~/.prismalens) is kept.
  -h, --help          Show this.

Environment:
  PRISMALENS_VERSION, PRISMALENS_NO_MODIFY_PATH=1   Same as the flags.
  PRISMALENS_DESKTOP=0           Same as --no-desktop; =1 installs the app even where it would be skipped.
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
	--no-desktop) want_desktop=0; shift ;;
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
	# A failed or timed-out request may still hold a redirect's headers: no size then.
	headers=$(curl -sIL --connect-timeout 20 --max-time 20 "$1" 2>/dev/null) || return 0
	printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { if (n) print n }'
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

# fetch_verified <name> <sha256> <file> <what>: v$version/<name> from each base in turn until one
# matches; on failure, $tried says why each base failed.
fetch_verified() {
	tried=
	for b in $bases; do
		h=$(host_of "$b")
		# A base with a successor is dropped after 30 s without a byte.
		if [ "$b" = "$sums_base" ]; then stall=; else stall=30; fi
		url="$b/v${version}/$1"
		bytes=$(remote_size "$url")
		size=
		[ -z "$bytes" ] || size=$(awk -v b="$bytes" 'BEGIN { printf " (%.0f MB)", b / 1048576 }')
		step "Downloading $4${size} from ${h}"
		fetch "$url" "$3" progress || { tried="${tried:+$tried; }${h}: download failed"; continue; }
		step "Verifying $(size_mb "$3") against SHA256SUMS from $(host_of "$sums_base")"
		[ "$(checksum "$3")" = "$2" ] && return 0
		tried="${tried:+$tried; }${h}: Checksum mismatch"
	done
	return 1
}

sum_of() { grep -E "(^|[[:space:]]|\*)$1\$" "$staging/SHA256SUMS" | cut -d' ' -f1 | head -n 1; }

# The entry is the installer's only when it opens the installer's app: the app's own download
# writes the same marker for its copy, which can live anywhere.
entry_ours() {
	[ -f "$desktop_file" ] && [ ! -L "$desktop_file" ] && grep -qxF "Exec=$(desktop_exec "$data_root/desktop/app/prismalens")" "$desktop_file"
}

# Homebrew's prismalens-app, whichever folder its --appdir put PrismaLens.app in.
cask_app() {
	for c in /opt/homebrew/Caskroom /usr/local/Caskroom; do [ ! -d "$c/prismalens-app" ] || return 0; done
	return 1
}

# Why the desktop app is skipped here, or nothing to install it. The receipt's desktop=0 keeps an earlier opt-out.
desktop_skip() {
	[ "$want_desktop" != 0 ] || { echo "you asked for the CLI only"; return 0; }
	if [ "$platform" = darwin ] && cask_app; then
		echo "Homebrew's prismalens-app is installed; it upgrades with brew upgrade"
		return 0
	elif [ "$platform" = darwin ] && [ -d "$mac_app" ] && [ "$(receipt_get desktop_app)" != "$mac_app" ]; then
		echo "$mac_app is already there and this installer didn't put it there; it was left as it is"
		return 0
	elif [ "$platform" = darwin ] && [ -d /Applications/PrismaLens.app ]; then
		echo "/Applications/PrismaLens.app is already there (Homebrew's prismalens-app or a download); upgrade it the way you installed it"
		return 0
	elif [ "$platform" = linux ] && { [ -e "$desktop_file" ] || [ -L "$desktop_file" ]; } && ! entry_ours; then
		echo "$desktop_file opens another copy of PrismaLens, not the installer's; it was left as it is"
		return 0
	fi
	[ "$want_desktop" != 1 ] || return 0
	if [ "$(receipt_get desktop)" = 0 ]; then
		echo "an earlier install left it out; set PRISMALENS_DESKTOP=1 to add it"
	elif [ -n "${CI:-}" ]; then
		echo "this is CI"
	elif [ "$platform" = darwin ] && [ "$(stat -f %Su /dev/console 2>/dev/null)" != "$(id -un)" ]; then
		echo "you aren't logged in to this Mac's desktop"
	elif [ "$platform" = linux ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
		echo "no display (DISPLAY and WAYLAND_DISPLAY are unset)"
	elif [ "$platform" = linux ] && ! command -v unzip >/dev/null 2>&1 && ! command -v bsdtar >/dev/null 2>&1; then
		echo "unzip is needed to unpack it; install unzip and run the installer again"
	fi
}

# The installed app, when it's running: `desktop_running <app path>`.
desktop_running() {
	command -v pgrep >/dev/null 2>&1 || return 1
	case "$1" in
	*.app) pgrep -f "$1/Contents/MacOS/PrismaLens" >/dev/null 2>&1 ;;
	*) pgrep -f "$1/prismalens" >/dev/null 2>&1 ;;
	esac
}

desktop_asset() {
	case "$target" in
	darwin-arm64) echo PrismaLens-macOS-ARM64-unsigned.zip ;;
	linux-x64) echo PrismaLens-Linux-X64-unsigned.zip ;;
	esac
}

# Exec's value per the Desktop Entry spec: a quoted argument (\ " ` $ escaped), then the
# string escape (\ doubled) and the field-code escape (% doubled).
desktop_exec() {
	printf '"%s"' "$(printf '%s' "$1" | sed -e 's/[\\"`$]/\\&/g')" | sed -e 's/\\/\\\\/g' -e 's/%/%%/g'
}

# Removes the app and launcher this installer recorded in its receipt, and nothing else.
remove_desktop() {
	r_app=$(receipt_get desktop_app)
	if [ "$platform" = darwin ] && cask_app; then
		r_app=
	fi
	if [ -n "$r_app" ] && [ -d "$r_app" ]; then
		rm -rf "$r_app"
		done_ "Removed the desktop app $r_app"
	fi
	if entry_ours; then
		rm -f "$desktop_file"
		done_ "Removed the app menu entry $desktop_file"
	fi
}

# install_desktop <zip>: the app in the OS's usual per-user place; sets $launcher to how it opens
# and $owned to what uninstall removes. The old copy moves aside into this run's own staging
# folder, so a failed move puts it back and a concurrent run can't delete it.
install_desktop() {
	if [ "$platform" = darwin ]; then
		d_dest="$mac_app"
		mkdir -p "$HOME/Applications"
		d_stage=$(mktemp -d "$HOME/Applications/.prismalens-new.XXXXXX") || { why="couldn't write to $HOME/Applications"; return 1; }
		ditto -x -k "$1" "$d_stage/unpacked" || { rm -rf "$d_stage"; why="couldn't unpack it"; return 1; }
		d_src=$(find "$d_stage/unpacked" -maxdepth 2 -name PrismaLens.app -type d | head -n 1)
	else
		d_dest="$data_root/desktop/app"
		mkdir -p "$data_root/desktop"
		d_stage=$(mktemp -d "$data_root/desktop/.new.XXXXXX") || { why="couldn't write to $data_root/desktop"; return 1; }
		if command -v unzip >/dev/null 2>&1; then
			unzip -q "$1" -d "$d_stage/unpacked" || { rm -rf "$d_stage"; why="couldn't unpack it"; return 1; }
		else
			mkdir -p "$d_stage/unpacked"
			bsdtar -xf "$1" -C "$d_stage/unpacked" || { rm -rf "$d_stage"; why="couldn't unpack it"; return 1; }
		fi
		d_src=$(find "$d_stage/unpacked" -mindepth 1 -maxdepth 1 -type d | head -n 1)
		[ -z "$d_src" ] || [ -x "$d_src/prismalens" ] || d_src=
	fi
	[ -n "$d_src" ] || { rm -rf "$d_stage"; why="the archive doesn't hold the app"; return 1; }
	[ ! -e "$d_dest" ] || mv "$d_dest" "$d_stage/previous" || { rm -rf "$d_stage"; why="couldn't move the old app aside"; return 1; }
	if ! mv "$d_src" "$d_dest"; then
		[ ! -e "$d_stage/previous" ] || mv "$d_stage/previous" "$d_dest"
		rm -rf "$d_stage"
		why="couldn't move it into place at $d_dest"
		return 1
	fi
	rm -rf "$d_stage"
	owned="$d_dest"
	if [ "$platform" = darwin ]; then
		# Launchpad and Spotlight would find it on their own; registering makes it immediate.
		lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
		[ -x "$lsregister" ] && "$lsregister" -f "$d_dest" >/dev/null 2>&1 || true
		launcher="Launchpad or Spotlight: PrismaLens (${d_dest})"
		return 0
	fi
	mkdir -p "$(dirname "$desktop_file")"
	# printf, not echo: some shells' echo rewrites the backslashes Exec escapes with.
	if ! {
		printf '%s\n' "[Desktop Entry]" "Type=Application" "Name=PrismaLens" \
			"Comment=Investigate alerts with the coding agent you already use" \
			"Exec=$(desktop_exec "$d_dest/prismalens")"
		[ ! -f "$d_dest/resources/icon.png" ] || printf 'Icon=%s\n' "$(printf '%s' "$d_dest/resources/icon.png" | sed -e 's/\\/\\\\/g')"
		printf '%s\n' "Terminal=false" "Categories=Development;" "StartupWMClass=PrismaLens" "$desktop_marker"
	} >"$desktop_file"; then
		why="the app is in $d_dest, but $desktop_file couldn't be written"
		return 1
	fi
	launcher="your app menu: PrismaLens (${desktop_file})"
	# Chromium's sandbox needs user namespaces or a root-owned setuid helper; every fix Chromium documents needs root.
	if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] ||
		[ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ]; then
		sandbox_note="This system restricts the user namespaces Chromium's sandbox needs, so the app may not open. Chromium's fix needs root, once per install or upgrade:
      sudo chown root:root \"$d_dest/chrome-sandbox\" && sudo chmod 4755 \"$d_dest/chrome-sandbox\"
    (https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)"
	fi
	return 0
}

# --- uninstall --------------------------------------------------------------

if [ "$action" = uninstall ]; then
	banner uninstaller
	if [ -n "$(receipt_get desktop_app)" ] && desktop_running "$(receipt_get desktop_app)"; then
		fail "The PrismaLens app is running; quit it and run the uninstaller again. Nothing was removed."
	fi
	installed_bin=$(receipt_get bin_dir)
	dir="${installed_bin:-$bin_dir}"
	# The background service runs this install's pl; remove it before pl goes (#732).
	if [ -f "$dir/pl" ] && { [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/prismalens.service" ] || [ -f "$HOME/Library/LaunchAgents/io.prismalens.server.plist" ]; }; then
		"$dir/pl" service uninstall >/dev/null 2>&1 && done_ "Removed the background service"
	fi
	remove_desktop
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

if [ "$want_desktop" = 0 ] && [ -n "$(receipt_get desktop_app)" ] && desktop_running "$(receipt_get desktop_app)"; then
	fail "The PrismaLens app is running; quit it and run the installer again to leave it out. Nothing was changed."
fi

archive="prismalens-${version}-${target}.tar.gz"
# The checksum is the release's own; the archive may come from any base and is verified against it.
expected=$(sum_of "$archive")
[ -n "$expected" ] || fail "${archive} isn't listed in SHA256SUMS on $(host_of "$sums_base"); nothing was installed."
fetch_verified "$archive" "$expected" "$staging/$archive" "PrismaLens ${version} for ${target}" ||
	fail "Couldn't install ${archive} from $(hosts_tried); nothing was installed. ${tried}"

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

# The desktop app is the release's own zip, verified like the CLI; a failure here leaves the CLI installed.
# desktop= is the user's choice; desktop_app= is what this installer put there, and all uninstall removes.
desktop=$(receipt_get desktop)
owned=$(receipt_get desktop_app)
launcher=
sandbox_note=
if [ "$want_desktop" = 0 ]; then
	desktop=0
	if [ -n "$owned" ]; then
		remove_desktop
		owned=
	fi
fi
[ "$want_desktop" != 1 ] || desktop=1
skip=$(desktop_skip)
app_asset=$(desktop_asset)
if [ -n "$skip" ]; then
	step "Desktop app skipped: $skip"
elif [ -z "$app_asset" ] || [ -z "$(sum_of "$app_asset")" ]; then
	warn "PrismaLens ${version} has no desktop app for ${target}, so only the CLI was installed."
else
	why=
	was_running=false
	[ -z "$owned" ] || ! desktop_running "$owned" || was_running=true
	if fetch_verified "$app_asset" "$(sum_of "$app_asset")" "$staging/$app_asset" "the PrismaLens ${version} desktop app"; then
		install_desktop "$staging/$app_asset" || true
	else
		why="couldn't download it from $(hosts_tried): ${tried}"
	fi
	if [ -n "$launcher" ]; then
		desktop=1
		done_ "Desktop app installed"
		! "$was_running" || warn "The PrismaLens app is still running the version it started with; quit it and open it again for ${version}."
	else
		warn "The desktop app wasn't installed: ${why}. The CLI is; run the installer again for the app."
	fi
fi

cat >"$receipt" <<EOF
version=$version
channel=installer
target=$target
bin_dir=$bin_dir
rc=$rc
desktop=$desktop
desktop_app=$owned
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
[ -z "$launcher" ] || printf '\n  Open the desktop app from %s\n' "$launcher" >&2
[ -z "$sandbox_note" ] || warn "$sandbox_note"
printf '\n  Start it with %spl up%s   ·   Upgrade with %spl upgrade%s   ·   Docs: https://docs.prismalens.io\n\n' \
	"$bold" "$r" "$bold" "$r" >&2
