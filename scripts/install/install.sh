#!/bin/sh
# PrismaLens standalone CLI installer (#717).
# Downloads and verifies the per-OS release archive; no Node required.
set -eu

fetch_url() {
	url="$1"
	dest="$2"
	case "$url" in
		file://*)
			path="${url#file://}"
			if [ -f "$path" ]; then
				cp "$path" "$dest"
				return 0
			fi
			return 1
			;;
	esac
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$url" -o "$dest"
	elif command -v wget >/dev/null 2>&1; then
		wget -q "$url" -O "$dest"
	else
		echo "curl or wget is required" >&2
		exit 1
	fi
}

platform=""
case "$(uname -s)" in
	Darwin) platform="darwin" ;;
	Linux) platform="linux" ;;
	*)
		echo "PrismaLens standalone installer does not support $(uname -s)." >&2
		echo "Install via npm instead: npm install -g prismalens" >&2
		exit 1
		;;
esac

arch=""
case "$(uname -m)" in
	arm64 | aarch64) arch="arm64" ;;
	x86_64 | amd64) arch="x64" ;;
	*)
		echo "PrismaLens standalone installer does not support $(uname -m)." >&2
		echo "Install via npm instead: npm install -g prismalens" >&2
		exit 1
		;;
esac

target="${platform}-${arch}"
case "$target" in
	darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64) ;;
	*)
		echo "PrismaLens standalone installer does not support ${target}." >&2
		echo "Install via npm instead: npm install -g prismalens" >&2
		exit 1
		;;
esac

command -v tar >/dev/null 2>&1 || {
	echo "tar is required" >&2
	exit 1
}

checksum() {
	file="$1"
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$file" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$file" | cut -d' ' -f1
	else
		echo "sha256sum or shasum is required" >&2
		exit 1
	fi
}

version="${PRISMALENS_VERSION:-}"
if [ -z "$version" ]; then
	latest_url="https://api.github.com/repos/prismalens/prismalens/releases/latest"
	tmp_meta="$(mktemp)"
	if ! fetch_url "$latest_url" "$tmp_meta"; then
		rm -f "$tmp_meta"
		echo "Could not fetch latest release info from GitHub API; set PRISMALENS_VERSION=<version>" >&2
		exit 1
	fi
	raw_tag="$(sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_meta" | head -n 1)"
	rm -f "$tmp_meta"
	version="$(printf '%s' "$raw_tag" | sed 's/^v//')"
	if [ -z "$version" ]; then
		echo "Could not determine latest version from GitHub API; set PRISMALENS_VERSION=<version>" >&2
		exit 1
	fi
fi

base_url="${PRISMALENS_RELEASE_BASE_URL:-https://github.com/prismalens/prismalens/releases/download}"
archive="prismalens-${version}-${target}.tar.gz"

staging="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$staging'" EXIT INT TERM

release_url=""
if fetch_url "${base_url}/v${version}/SHA256SUMS" "${staging}/SHA256SUMS"; then
	release_url="${base_url}/v${version}"
elif fetch_url "${base_url}/SHA256SUMS" "${staging}/SHA256SUMS"; then
	release_url="${base_url}"
else
	echo "PrismaLens ${version} has no release archive or SHA256SUMS at ${base_url}" >&2
	exit 1
fi

if ! fetch_url "${release_url}/${archive}" "${staging}/${archive}"; then
	echo "Failed to download ${archive} from ${release_url}" >&2
	exit 1
fi

expected="$(grep -E "(^|[[:space:]]|\*)${archive}\$" "${staging}/SHA256SUMS" | cut -d' ' -f1 | head -n 1)"
if [ -z "$expected" ]; then
	echo "${archive} is not listed in SHA256SUMS" >&2
	exit 1
fi

actual="$(checksum "${staging}/${archive}")"
if [ "$actual" != "$expected" ]; then
	echo "checksum mismatch for ${archive}" >&2
	echo "Expected: $expected" >&2
	echo "Actual:   $actual" >&2
	exit 1
fi

tar -xzf "${staging}/${archive}" -C "$staging"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
runtime_dir="${data_home}/prismalens/runtime/${version}"
rm -rf "$runtime_dir"
mkdir -p "$runtime_dir"

extracted_dir="${staging}/prismalens-${version}-${target}"
if [ -d "$extracted_dir" ]; then
	cp -R "${extracted_dir}/." "$runtime_dir/"
else
	echo "Archive structure unexpected: ${extracted_dir} not found" >&2
	exit 1
fi

bin_dir="${PRISMALENS_INSTALL_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"

cat > "${bin_dir}/pl" <<EOF
#!/bin/sh
exec "$runtime_dir/bin/pl" "\$@"
EOF
chmod 755 "${bin_dir}/pl"

cat > "${bin_dir}/prismalens" <<EOF
#!/bin/sh
exec "$runtime_dir/bin/prismalens" "\$@"
EOF
chmod 755 "${bin_dir}/prismalens"

case ":$PATH:" in
	*":$bin_dir:"*) ;;
	*)
		echo "Add $bin_dir to your PATH to run pl directly."
		;;
esac

"$bin_dir/pl" --version
echo "run \`pl up\`"
