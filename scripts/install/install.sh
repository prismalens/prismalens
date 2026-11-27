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
# dir_path <dir> [-P]: <dir> as an absolute path without a trailing slash or .., even before it
# exists; -P also resolves its symlinks. A rerun spells paths as the receipt does.
dir_path() {
	p_dir=$1 p_rest=
	while [ "$p_dir" != / ] && [ "${p_dir%/}" != "$p_dir" ]; do p_dir=${p_dir%/}; done
	while [ ! -d "$p_dir" ]; do p_rest="/${p_dir##*/}$p_rest" p_dir=$(dirname -- "$p_dir"); done
	p_base=$(CDPATH='' cd -- "$p_dir" && pwd ${2:-})
	printf '%s%s' "${p_base%/}" "$p_rest"
}
data_root=$(dir_path "${PRISMALENS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/prismalens}")
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
desktop_launch="$data_root/desktop/launch"
# Test seams: where the kernel's user-namespace restriction and the app's AppArmor profile are read.
userns_sysctl="${PRISMALENS_USERNS_SYSCTL:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}"
apparmor_profile="${PRISMALENS_APPARMOR_PROFILE:-/etc/apparmor.d/prismalens}"
nl='
'
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
# Only the [Desktop Entry] group counts: an action's Exec isn't what the menu opens.
entry_ours() {
	[ -f "$desktop_file" ] && [ ! -L "$desktop_file" ] &&
		E_LAUNCH="Exec=/bin/sh $(desktop_exec "$desktop_launch")" E_APP="Exec=$(desktop_exec "$data_root/desktop/app/prismalens")" \
			E_MARK="$desktop_marker" awk '
			/^\[/ { main = ($0 == "[Desktop Entry]"); next }
			main && ($0 == ENVIRON["E_LAUNCH"] || $0 == ENVIRON["E_APP"]) { exec_ok = 1 }
			main && $0 == ENVIRON["E_MARK"] { marked = 1 }
			END { exit !(exec_ok && marked) }' "$desktop_file"
}

# $1 as one single-quoted sh word.
sh_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Each install marks the app it unpacked with a random ID the receipt keeps, inside the app, so
# other contents in the same folder don't carry it. On macOS it's an extended attribute on the
# bundle's executable, which leaves the signed contents as they were.
new_install_id() { od -An -N8 -tx1 /dev/urandom | tr -d ' \n'; }
app_id_of() {
	if [ "$(uname -s)" = Darwin ]; then
		xattr -p io.prismalens.install-id "$1/Contents/MacOS/PrismaLens" 2>/dev/null
	else
		cat "$1/.prismalens-install-id" 2>/dev/null
	fi
}
set_app_id() {
	if [ "$(uname -s)" = Darwin ]; then
		xattr -w io.prismalens.install-id "$2" "$1/Contents/MacOS/PrismaLens"
	else
		printf '%s\n' "$2" >"$1/.prismalens-install-id"
	fi
}

# Whether $1 is the app this installer put there: the receipt names it and it carries the receipt's ID.
app_ours() {
	[ -n "$1" ] && [ -d "$1" ] && [ "$(receipt_get desktop_app)" = "$1" ] &&
		[ -n "$(receipt_get desktop_app_id)" ] && [ "$(app_id_of "$1")" = "$(receipt_get desktop_app_id)" ]
}

# Where an app sits: desktop/app, a staging folder's previous, or a *.app bundle.
is_app_slot() { case "$1" in */desktop/app | */previous | *.app) return 0 ;; esac; return 1; }

# Whether the app at $1 is one this install unpacked: it sits where the receipt says or in this
# installer's staging, and carries the receipt's ID or this run's. A copy elsewhere is the user's.
app_mine() {
	[ ! -L "$1" ] || return 1
	case "$1" in
	"$(receipt_get desktop_app)" | "$data_root"/desktop/.new.*/previous | "$HOME"/Applications/.prismalens-new.*/previous) ;;
	*) return 1 ;;
	esac
	k_id=$(app_id_of "$1" || true)
	[ -n "$k_id" ] && { [ "$k_id" = "$(receipt_get desktop_app_id)" ] || [ "$k_id" = "${d_id:-}" ]; }
}

# purge <path>: deletes it, the install ID last, so a delete that stops partway leaves an app still marked as ours.
purge() {
	find "$1" ! -type d ! -name .prismalens-install-id ! -path '*/Contents/MacOS/PrismaLens' -exec rm -f {} + || return 1
	rm -rf "$1"
}

# delete_around <dir> <list>: deletes what's in <dir> except the paths in <list> and the folders
# that hold them. A subshell per level keeps each level's loop variables its own.
delete_around() {
	a_st=0
	for a_c in "$1"/* "$1"/.[!.]* "$1"/..?*; do
		[ -e "$a_c" ] || [ -L "$a_c" ] || continue
		if grep -qxF -- "$a_c" "$2"; then
			continue
		elif A_P="$a_c/" awk 'index($0, ENVIRON["A_P"]) == 1 { f = 1 } END { exit !f }' "$2"; then
			(delete_around "$a_c" "$2") || a_st=1
		else
			purge "$a_c" || a_st=1
		fi
	done
	return "$a_st"
}

# The only way this installer deletes a folder. What it put there goes; an app it didn't (no
# receipt ID nor this run's, or a link at an app's place) stays where it is with the folders
# around it, and is named. 1 when something couldn't be looked through or deleted.
discard() {
	[ -e "$1" ] || [ -L "$1" ] || return 0
	if is_app_slot "$1"; then
		app_mine "$1" || { warn "$1 isn't the app this installer put there; it was left as it is"; return 0; }
		purge "$1"
		return
	fi
	k_list=$(mktemp) || return 1
	# Below $1 only: $1 itself may be named like a pruned folder (PRISMALENS_HOME=.../runtime).
	if ! find "$1" -mindepth 1 -maxdepth 3 \( -name unpacked -o -name runtime -o -name node_modules \) -prune -o \
		\( -type d -o -type l \) \( -name previous -o -name '*.app' -o -path '*/desktop/app' \) -prune -print >"$k_list"; then
		rm -f "$k_list"
		warn "couldn't look through $1, so it was left as it is"
		return 1
	fi
	k_left=$(mktemp) || { rm -f "$k_list"; return 1; }
	while IFS= read -r k_app; do app_mine "$k_app" || printf '%s\n' "$k_app" >>"$k_left"; done <"$k_list"
	rm -f "$k_list"
	if [ ! -s "$k_left" ]; then
		rm -f "$k_left"
		purge "$1"
		return
	fi
	while IFS= read -r k_app; do warn "$k_app isn't the app this installer put there; it and the folders that hold it were left as they are"; done <"$k_left"
	k_st=0
	(delete_around "$1" "$k_left") || k_st=1
	rm -f "$k_left"
	return "$k_st"
}

# A run killed between its two renames left the installer's old app in that run's staging
# folder; put it back before anything else, so the launcher works even if no download does, and
# uninstall finds it where the receipt says. uname, not $platform: uninstall runs before it is set.
desktop_recover() {
	if [ "$(uname -s)" = Darwin ]; then
		r_dest="$mac_app" r_stage="$HOME/Applications/.prismalens-new."
	else
		r_dest="$data_root/desktop/app" r_stage="$data_root/desktop/.new."
	fi
	[ ! -e "$r_dest" ] && [ "$(receipt_get desktop_app)" = "$r_dest" ] || return 0
	for r_prev in "$r_stage"*/previous; do
		[ "$(app_id_of "$r_prev")" = "$(receipt_get desktop_app_id)" ] || continue
		mv "$r_prev" "$r_dest" || continue
		discard "$(dirname "$r_prev")"
		done_ "Put back the desktop app an interrupted install had moved aside"
		return 0
	done
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
	elif [ "$platform" = darwin ] && [ -d "$mac_app" ] && ! app_ours "$mac_app"; then
		echo "$mac_app is already there and this installer didn't put it there; it was left as it is"
		return 0
	elif [ "$platform" = darwin ] && [ -d /Applications/PrismaLens.app ]; then
		echo "/Applications/PrismaLens.app is already there (Homebrew's prismalens-app or a download); upgrade it the way you installed it"
		return 0
	elif [ "$platform" = linux ] && { [ -e "$desktop_file" ] || [ -L "$desktop_file" ]; } && ! entry_ours; then
		echo "$desktop_file opens another copy of PrismaLens, not the installer's; it was left as it is"
		return 0
	elif [ "$platform" = linux ] && [ -e "$data_root/desktop/app" ] && ! app_ours "$data_root/desktop/app"; then
		echo "$data_root/desktop/app isn't the app this installer put there; it was left as it is"
		return 0
	elif [ "$platform" = linux ]; then
		case "$data_root" in
		*"$nl"*)
			echo "$data_root has a line break, which a menu entry can't hold"
			return 0
			;;
		*=*)
			echo "$data_root has an =, which a menu entry's program path can't hold"
			return 0
			;;
		esac
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
	*.app) d_exe="$1/Contents/MacOS/PrismaLens" ;;
	*) d_exe="$1/prismalens" ;;
	esac
	# pgrep -f takes an extended regex: escape the path, and match it as the command itself.
	pgrep -f "^$(printf '%s' "$d_exe" | sed -e 's/[][\\.*^$+?(){}|]/\\&/g')( |\$)" >/dev/null 2>&1
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
	# uname, not $platform: uninstall runs before the platform is worked out.
	if [ "$(uname -s)" = Darwin ] && cask_app; then
		r_app=
	fi
	if [ -n "$r_app" ] && desktop_running "$r_app"; then
		warn "The PrismaLens app started meanwhile, so $r_app stays; quit it and run this again to remove it."
		return 1
	fi
	# 1, with the receipt as it was, when the installer's own app or entry can't be removed.
	if app_ours "$r_app"; then
		discard "$r_app" || { warn "Couldn't remove the desktop app $r_app; it is still the installer's, so running this again retries."; return 1; }
		done_ "Removed the desktop app $r_app"
	elif [ -n "$r_app" ] && { [ -e "$r_app" ] || [ -L "$r_app" ]; }; then
		warn "$r_app isn't the app this installer put there, so it wasn't removed"
	fi
	if entry_ours; then
		rm -f "$desktop_file" || { warn "Couldn't remove the app menu entry $desktop_file; running this again retries."; return 1; }
		done_ "Removed the app menu entry $desktop_file"
	fi
	rm -f "$desktop_launch" "$data_root/desktop/apparmor-profile"
	[ ! -e "$apparmor_profile" ] || warn "$apparmor_profile stays; it needs root to remove: sudo apparmor_parser -R $(sh_quote "$apparmor_profile") && sudo rm $(sh_quote "$apparmor_profile")"
	return 0
}

# install_desktop <zip>: the app in the OS's usual per-user place; sets $launcher to how it opens
# and $owned to what uninstall removes. The old copy moves aside into this run's own staging
# folder, so a failed move puts it back and a concurrent run can't delete it.
install_desktop() {
	if [ "$platform" = darwin ]; then
		d_dest="$mac_app"
		mkdir -p "$HOME/Applications"
		d_stage=$(mktemp -d "$HOME/Applications/.prismalens-new.XXXXXX") || { why="couldn't write to $HOME/Applications"; return 1; }
		ditto -x -k "$1" "$d_stage/unpacked" || { discard "$d_stage"; why="couldn't unpack it"; return 1; }
		d_src=$(find "$d_stage/unpacked" -maxdepth 2 -name PrismaLens.app -type d | head -n 1)
	else
		d_dest="$data_root/desktop/app"
		mkdir -p "$data_root/desktop"
		d_stage=$(mktemp -d "$data_root/desktop/.new.XXXXXX") || { why="couldn't write to $data_root/desktop"; return 1; }
		if command -v unzip >/dev/null 2>&1; then
			unzip -q "$1" -d "$d_stage/unpacked" || { discard "$d_stage"; why="couldn't unpack it"; return 1; }
		else
			mkdir -p "$d_stage/unpacked"
			bsdtar -xf "$1" -C "$d_stage/unpacked" || { discard "$d_stage"; why="couldn't unpack it"; return 1; }
		fi
		d_src=$(find "$d_stage/unpacked" -mindepth 1 -maxdepth 1 -type d | head -n 1)
		[ -z "$d_src" ] || [ -x "$d_src/prismalens" ] || d_src=
	fi
	[ -n "$d_src" ] || { discard "$d_stage"; why="the archive doesn't hold the app"; return 1; }
	# Checked again here: another app can appear in this place while the zip downloads.
	if [ -e "$d_dest" ] && ! app_ours "$d_dest"; then
		discard "$d_stage"
		why="$d_dest isn't the app this installer put there; it was left as it is"
		return 1
	fi
	d_id=$owned_id
	set_app_id "$d_src" "$d_id" || { discard "$d_stage"; why="couldn't mark the app as this installer's"; return 1; }
	[ ! -e "$d_dest" ] || mv "$d_dest" "$d_stage/previous" || { discard "$d_stage"; why="couldn't move the old app aside"; return 1; }
	# What was moved aside is checked once more: an app that arrived after the check above goes
	# back, or is kept where it is; staging is only deleted with the installer's own app in it.
	if [ -e "$d_stage/previous" ] && [ "$(app_id_of "$d_stage/previous")" != "$(receipt_get desktop_app_id)" ]; then
		if [ ! -e "$d_dest" ] && mv "$d_stage/previous" "$d_dest"; then
			discard "$d_stage"
			why="$d_dest isn't the app this installer put there; it was left as it is"
		else
			discard "$d_stage" || true
			why="$d_dest isn't the app this installer put there, and couldn't go back; it is kept in $d_stage/previous"
		fi
		return 1
	fi
	if ! mv "$d_src" "$d_dest"; then
		if [ -e "$d_stage/previous" ] && { [ -e "$d_dest" ] || ! mv "$d_stage/previous" "$d_dest"; }; then
			why="couldn't move it into place at $d_dest, nor put the old app back; it is in $d_stage/previous, and the next install puts it back"
			return 1
		fi
		discard "$d_stage"
		why="couldn't move it into place at $d_dest"
		return 1
	fi
	# A folder that appeared at $d_dest makes mv nest the app inside it: only the app itself there counts.
	if [ "$(app_id_of "$d_dest" || true)" != "$d_id" ] || [ -e "$d_dest/${d_src##*/}" ]; then
		mv "$d_dest/${d_src##*/}" "$d_src" 2>/dev/null || true
		why="something else appeared at $d_dest during the install, so the new app wasn't put there; the old one is kept in $d_stage/previous"
		return 1
	fi
	discard "$d_stage"
	owned="$d_dest"
	if [ "$platform" = darwin ]; then
		# Launchpad and Spotlight would find it on their own; registering makes it immediate.
		lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
		[ -x "$lsregister" ] && "$lsregister" -f "$d_dest" >/dev/null 2>&1 || true
		launcher="Launchpad or Spotlight: PrismaLens (${d_dest})"
		return 0
	fi
	write_launch "$d_dest/prismalens" || { why="the app is in $d_dest, but $desktop_launch couldn't be written"; return 1; }
	mkdir -p "$(dirname "$desktop_file")"
	# Checked again here: another copy can register its entry while the zip downloads.
	if { [ -e "$desktop_file" ] || [ -L "$desktop_file" ]; } && ! entry_ours; then
		why="the app is in $d_dest, but $desktop_file now opens another copy of PrismaLens; it was left as it is"
		return 1
	fi
	# printf, not echo: some shells' echo rewrites the backslashes Exec escapes with. /bin/sh is
	# argv[0] because GLib looks argv[0] up before it turns %% back into %, so a % path hid the entry.
	if ! {
		printf '%s\n' "[Desktop Entry]" "Type=Application" "Name=PrismaLens" \
			"Comment=Investigate alerts with the coding agent you already use" \
			"Exec=/bin/sh $(desktop_exec "$desktop_launch")"
		[ ! -f "$d_dest/resources/icon.png" ] || printf 'Icon=%s\n' "$(printf '%s' "$d_dest/resources/icon.png" | sed -e 's/\\/\\\\/g')"
		printf '%s\n' "Terminal=false" "Categories=Development;" "StartupWMClass=PrismaLens" "$desktop_marker"
	} >"$desktop_file"; then
		why="the app is in $d_dest, but $desktop_file couldn't be written"
		return 1
	fi
	launcher="your app menu: PrismaLens (${desktop_file})"
	# Ubuntu's documented fix for its user-namespace restriction is a userns profile for the app
	# (noble release notes, Security Improvements); the app's sandbox stays on.
	l_rule=$(printf '%s' "$d_dest/prismalens" | sed -e 's/[][\\"*?{}^]/\\&/g')
	printf '%s\n' "abi <abi/4.0>," "include <tunables/global>" "" \
		"profile prismalens \"$l_rule\" flags=(unconfined) {" "  userns," "" "  include if exists <local/prismalens>" "}" \
		>"$data_root/desktop/apparmor-profile" || true
	if [ "$(cat "$userns_sysctl" 2>/dev/null)" = 1 ] && [ ! -e "$apparmor_profile" ]; then
		sandbox_note="Ubuntu restricts the user namespaces the app's sandbox needs, so it opens once AppArmor allows it. Ubuntu's documented fix is a profile for the app; adding it needs root, once:
      $(apparmor_command)
    (https://discourse.ubuntu.com/t/noble-numbat-release-notes/39890, Security Improvements)"
	elif [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ]; then
		sandbox_note="This system turns off the user namespaces the app's sandbox needs, so the app may not open; pl up opens PrismaLens in your browser instead."
	fi
	return 0
}

# write_receipt <desktop_app> <desktop_app_id>: through a temporary file and a rename, so a
# short write never leaves half a receipt and a link at its path is replaced, not followed.
write_receipt() {
	cat >"$receipt.new" <<EOF
version=$version
channel=installer
target=$target
bin_dir=$bin_dir
rc=$rc
desktop=$desktop
desktop_app=$1
desktop_app_id=$2
desktop_version=$desktop_version
installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
	mv -f "$receipt.new" "$receipt"
}

# The one root step that lets the app's sandbox run under Ubuntu's user-namespace restriction.
apparmor_command() {
	printf 'sudo install -m 644 %s %s && sudo apparmor_parser -r %s' \
		"$(sh_quote "$data_root/desktop/apparmor-profile")" "$(sh_quote "$apparmor_profile")" "$(sh_quote "$apparmor_profile")"
}

# write_launch <app binary>: what the menu entry runs. A menu entry can't say why an app didn't
# open, so where AppArmor would stop the sandbox, the launcher says it and how to allow it.
write_launch() {
	l_msg="Ubuntu's AppArmor stops the PrismaLens sandbox until the app has a profile. Run this once in a terminal, then open PrismaLens again: $(apparmor_command)"
	{
		printf '%s\n' "#!/bin/sh" "# Written by the PrismaLens installer; the app menu entry runs it."
		printf 'if [ "$(cat %s 2>/dev/null)" = 1 ] && [ ! -e %s ]; then\n' "$(sh_quote "$userns_sysctl")" "$(sh_quote "$apparmor_profile")"
		printf '\tmsg=%s\n' "$(sh_quote "$l_msg")"
		cat <<'LAUNCH'
	printf '%s\n' "$msg" >&2
	notify-send -a PrismaLens "PrismaLens can't open yet" "$msg" 2>/dev/null ||
		zenity --error --text="$msg" 2>/dev/null || kdialog --error "$msg" 2>/dev/null || true
	exit 1
fi
LAUNCH
		printf 'exec %s "$@"\n' "$(sh_quote "$1")"
	} >"$desktop_launch" || return 1
	chmod 755 "$desktop_launch"
}

# One installer at a time per data root: two at once could each delete what the other put in place.
# The lock is a folder beside the data root holding its installer's process ID; one whose process
# is gone was left by a killed run and is taken over.
lock_dir="${data_root}.lock"
take_lock() {
	mkdir -p "$(dirname -- "$lock_dir")"
	if ! mkdir "$lock_dir" 2>/dev/null; then
		l_pid=$(cat "$lock_dir/pid" 2>/dev/null || true)
		if [ -z "$l_pid" ] || kill -0 "$l_pid" 2>/dev/null; then
			fail "Another PrismaLens installer is running${l_pid:+ (process $l_pid)}; run this again once it finishes. Nothing was changed. If none is running, remove $lock_dir."
		fi
		rm -f "$lock_dir/pid"
		rmdir "$lock_dir" 2>/dev/null || true
		mkdir "$lock_dir" 2>/dev/null || fail "Another PrismaLens installer just started; run this again once it finishes. Nothing was changed."
	fi
	echo "$$" >"$lock_dir/pid"
	lock_held=1
	trap 'release_lock' EXIT
	trap 'exit 130' INT TERM
}
release_lock() {
	[ -n "${lock_held:-}" ] || return 0
	rm -f "$lock_dir/pid"
	rmdir "$lock_dir" 2>/dev/null || true
}

# --- uninstall --------------------------------------------------------------

if [ "$action" = uninstall ]; then
	banner uninstaller
	take_lock
	desktop_recover
	if [ -n "$(receipt_get desktop_app)" ] && desktop_running "$(receipt_get desktop_app)"; then
		fail "The PrismaLens app is running; quit it and run the uninstaller again. Nothing was removed."
	fi
	installed_bin=$(receipt_get bin_dir)
	dir="${installed_bin:-$bin_dir}"
	# The background service runs this install's pl; remove it before pl goes (#732).
	if [ -f "$dir/pl" ] && { [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/prismalens.service" ] || [ -f "$HOME/Library/LaunchAgents/io.prismalens.server.plist" ]; }; then
		"$dir/pl" service uninstall >/dev/null 2>&1 && done_ "Removed the background service"
	fi
	remove_desktop || fail "Nothing else was removed."
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
	workspace=$(dir_path "${PRISMALENS_WORKSPACE_DIR:-$HOME/.prismalens}" -P)
	if [ -d "$data_root" ]; then
		if [ "$(receipt_get channel)" != installer ]; then
			warn "$data_root holds no receipt from this installer, so it was left as it is"
		elif case "$workspace/" in "$(dir_path "$data_root" -P)/"*) true ;; *) false ;; esac; then
			warn "Your workspace is inside $data_root, so $data_root was left as it is"
		elif discard "$data_root"; then
			if [ -e "$data_root" ]; then warn "$data_root stays, holding only what this installer didn't put there"; else done_ "Removed $data_root"; fi
		else
			warn "$data_root was kept"
		fi
	fi
	[ -n "$installed_bin$rc" ] || [ -d "$data_root" ] || warn "Nothing installed by this installer was found."
	printf '\n  Your workspace is kept: %s\n  To delete it as well, run %spl reset%s first, or remove that folder.\n\n' \
		"${PRISMALENS_WORKSPACE_DIR:-$HOME/.prismalens}" "$bold" "$r" >&2
	exit 0
fi

# --- install ----------------------------------------------------------------

banner installer
take_lock

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
desktop_recover

staging=$(mktemp -d)
trap 'discard "$staging"; release_lock' EXIT

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
# Before the CLI changes, so a removal that fails leaves the install as it was.
if [ "$want_desktop" = 0 ] && [ -n "$(receipt_get desktop_app)" ]; then
	remove_desktop || fail "Nothing else was changed."
fi

archive="prismalens-${version}-${target}.tar.gz"
# The checksum is the release's own; the archive may come from any base and is verified against it.
expected=$(sum_of "$archive")
[ -n "$expected" ] || fail "${archive} isn't listed in SHA256SUMS on $(host_of "$sums_base"); nothing was installed."
fetch_verified "$archive" "$expected" "$staging/$archive" "PrismaLens ${version} for ${target}" ||
	fail "Couldn't install ${archive} from $(hosts_tried); nothing was installed. ${tried}"

# A pl or prismalens in the bin dir that this installer didn't write is someone's own: never replaced.
for name in pl prismalens; do
	if [ -L "$bin_dir/$name" ] || { [ -e "$bin_dir/$name" ] && ! grep -q "$marker" "$bin_dir/$name" 2>/dev/null; }; then
		fail "$bin_dir/$name isn't a wrapper this installer wrote, so nothing was installed; it was left as it is. Set PRISMALENS_INSTALL_BIN_DIR to install pl somewhere else."
	fi
done

step "Installing to ${runtime_root}/${version}"
tar -xzf "$staging/$archive" -C "$staging"
[ -d "$staging/prismalens-${version}-${target}" ] || fail "Unexpected archive layout"
mkdir -p "$runtime_root"
discard "${runtime_root:?}/${version}.new"
mv "$staging/prismalens-${version}-${target}" "$runtime_root/${version}.new"
discard "${runtime_root:?}/${version}"
mv "$runtime_root/${version}.new" "$runtime_root/${version}"

mkdir -p "$bin_dir"
for name in pl prismalens; do
	cat >"$bin_dir/$name.new" <<EOF
#!/bin/sh
$marker
exec "$runtime_root/$version/bin/$name" "\$@"
EOF
	chmod 755 "$bin_dir/$name.new"
	mv -f "$bin_dir/$name.new" "$bin_dir/$name"
done

# Keep this version and the one it replaced, for rollback.
for dir in "$runtime_root"/*; do
	[ -d "$dir" ] || continue
	v=${dir##*/}
	[ "$v" = "$version" ] || [ "$v" = "$installed" ] || discard "$dir"
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
owned_id=$(receipt_get desktop_app_id)
desktop_version=$(receipt_get desktop_version)
launcher=
sandbox_note=
if [ "$want_desktop" = 0 ]; then
	desktop=0
	owned=
	owned_id=
	desktop_version=
fi
[ "$want_desktop" != 1 ] || desktop=1
skip=$(desktop_skip)
app_asset=$(desktop_asset)
if [ -n "$skip" ]; then
	step "Desktop app skipped: $skip"
elif [ -z "$app_asset" ] || [ -z "$(sum_of "$app_asset")" ]; then
	warn "PrismaLens ${version} has no desktop app for ${target}, so only the CLI was installed."
elif [ -n "$owned" ] && desktop_running "$owned"; then
	# Replacing a running app's files under it breaks the helpers it starts later.
	warn "The PrismaLens app is running, so it stays at ${desktop_version:-the version it has}; quit it and run the installer again to update it."
else
	why=
	if fetch_verified "$app_asset" "$(sum_of "$app_asset")" "$staging/$app_asset" "the PrismaLens ${version} desktop app"; then
		# One ID for every copy this install unpacks, recorded with the app's path before it's
		# unpacked, so a copy a killed run leaves is still the installer's.
		[ -n "$owned_id" ] || owned_id=$(new_install_id)
		if [ "$platform" = darwin ]; then write_receipt "$mac_app" "$owned_id"; else write_receipt "$data_root/desktop/app" "$owned_id"; fi
		install_desktop "$staging/$app_asset" || true
	else
		why="couldn't download it from $(hosts_tried): ${tried}"
	fi
	if [ -n "$launcher" ]; then
		desktop=1
		desktop_version=$version
		done_ "Desktop app installed"
	else
		warn "The desktop app wasn't installed: ${why}. The CLI is; run the installer again for the app."
	fi
fi

write_receipt "$owned" "$owned_id"

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
