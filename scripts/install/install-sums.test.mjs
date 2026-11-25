// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// install.sh takes SHA256SUMS from GitHub only and verifies an archive from any base against it,
// run against a fake curl that serves a mirror directory and a GitHub directory.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const INSTALLER = fileURLToPath(new URL("./install.sh", import.meta.url));
const MIRROR = "https://downloads.prismalens.io";
const GITHUB = "https://github.com/prismalens/prismalens/releases/download";
// A fake uname makes the host linux-x64 whatever runs the test, Git Bash on Windows included.
const platform = "linux";
const arch = "x64";
const skip =
	spawnSync("sh", ["-c", "command -v tar sha256sum"]).status === 0
		? false
		: "needs sh with tar and sha256sum";
const ARCHIVE = `prismalens-0.5.6-${platform}-${arch}.tar.gz`;

const FAKE_CURL = `#!/bin/sh
url=
out=
speed=plain
prev=
for a in "$@"; do
	case "$a" in https://*) url=$a ;; --speed-limit) speed=stall ;; esac
	[ "$prev" != -o ] || out=$a
	prev=$a
done
case "$*" in *" -sIL "*|"-sIL "*)
	# HANG_SIZE: a redirect answers, then the final headers never come; only a total time limit ends it.
	[ "\${HANG_SIZE:-}" = 1 ] || exit 0
	printf 'HTTP/1.1 302 Found\\r\\nContent-Length: 5242880000\\r\\n\\r\\n'
	case "$*" in *--max-time*) exit 28 ;; esac
	sleep 60
	exit 0 ;;
esac
echo "$url $speed" >>"$FAKE_LOG"
case "$url" in
"${MIRROR}/"*) file="$MIRROR_ROOT/\${url#${MIRROR}/}" ;;
"${GITHUB}/"*) file="$GITHUB_ROOT/\${url#${GITHUB}/}" ;;
*) exit 6 ;;
esac
[ "\${FAIL_MIRROR_ARCHIVE:-}" != 1 ] || case "$url" in "${MIRROR}/"*.tar.gz) exit 18 ;; esac
[ -f "$file" ] || exit 22
cp "$file" "$out"
`;

const UNAME = `#!/bin/sh
case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac
`;

/** A release dir v0.5.6/ holding an archive whose pl prints `says`, and its SHA256SUMS. */
function release(root, says, { sums = true } = {}) {
	const stage = mkdtempSync(join(tmpdir(), "pl-stage-"));
	const top = join(stage, `prismalens-0.5.6-${platform}-${arch}`, "bin");
	mkdirSync(top, { recursive: true });
	for (const name of ["pl", "prismalens"]) {
		writeFileSync(join(top, name), `#!/bin/sh\necho "${says}"\n`);
		chmodSync(join(top, name), 0o755);
	}
	const dir = join(root, "v0.5.6");
	mkdirSync(dir, { recursive: true });
	execFileSync(
		"tar",
		[
			"-czf",
			ARCHIVE.replace(/^/, "../out-"),
			`prismalens-0.5.6-${platform}-${arch}`,
		],
		{ cwd: stage },
	);
	copyFileSync(join(stage, "..", `out-${ARCHIVE}`), join(dir, ARCHIVE));
	const digest = createHash("sha256")
		.update(readFileSync(join(dir, ARCHIVE)))
		.digest("hex");
	if (sums) writeFileSync(join(dir, "SHA256SUMS"), `${digest}  ${ARCHIVE}\n`);
	return digest;
}

function run(extraEnv = {}) {
	const work = mkdtempSync(join(tmpdir(), "pl-install-test-"));
	const mirror = join(work, "mirror");
	const github = join(work, "github");
	const bin = join(work, "fake");
	mkdirSync(bin);
	writeFileSync(join(bin, "curl"), FAKE_CURL);
	writeFileSync(join(bin, "uname"), UNAME);
	for (const name of ["curl", "uname"]) chmodSync(join(bin, name), 0o755);
	const log = join(work, "requests.log");
	writeFileSync(log, "");
	const go = () =>
		spawnSync("sh", [INSTALLER], {
			encoding: "utf8",
			// A request with no time limit would hang here, not fail.
			timeout: 30_000,
			env: {
				PATH: `${bin}${delimiter}${process.env.PATH}`,
				HOME: join(work, "home"),
				PRISMALENS_HOME: join(work, "data"),
				PRISMALENS_INSTALL_BIN_DIR: join(work, "bin"),
				PRISMALENS_VERSION: "0.5.6",
				PRISMALENS_NO_MODIFY_PATH: "1",
				CI: "1",
				FAKE_LOG: log,
				MIRROR_ROOT: mirror,
				GITHUB_ROOT: github,
				...extraEnv,
			},
		});
	return {
		mirror,
		github,
		go,
		requests: () =>
			readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
		installed: () =>
			existsSync(join(work, "data", "runtime", "0.5.6", "bin", "pl")),
		pl: () =>
			execFileSync("sh", [join(work, "bin", "pl")], {
				encoding: "utf8",
				env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
			}).trim(),
	};
}

test("a mirror's altered archive with matching SHA256SUMS is refused: the checksum comes from GitHub", {
	skip,
}, () => {
	const t = run();
	release(t.mirror, "altered");
	release(t.github, "genuine");
	const result = t.go();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(t.pl(), "genuine");
	assert.deepEqual(t.requests(), [
		`${GITHUB}/v0.5.6/SHA256SUMS plain`,
		`${MIRROR}/v0.5.6/${ARCHIVE} stall`,
		`${GITHUB}/v0.5.6/${ARCHIVE} plain`,
	]);
});

test("without GitHub's SHA256SUMS nothing installs, though the mirror has the archive and its own sums", {
	skip,
}, () => {
	const t = run();
	release(t.mirror, "mirror");
	const result = t.go();
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/Couldn't fetch SHA256SUMS for 0\.5\.6 from github\.com, the only source of checksums, so nothing was installed\./,
	);
	assert.deepEqual(t.requests(), [`${GITHUB}/v0.5.6/SHA256SUMS plain`]);
	assert.equal(t.installed(), false);
});

test("a mirror whose transfer breaks hands over to GitHub, and only the mirror is given a stall limit", {
	skip,
}, () => {
	const t = run({ FAIL_MIRROR_ARCHIVE: "1" });
	release(t.mirror, "mirror");
	release(t.github, "genuine");
	const result = t.go();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(t.pl(), "genuine");
	assert.deepEqual(t.requests(), [
		`${GITHUB}/v0.5.6/SHA256SUMS plain`,
		`${MIRROR}/v0.5.6/${ARCHIVE} stall`,
		`${GITHUB}/v0.5.6/${ARCHIVE} plain`,
	]);
});

test("a mirror that never finishes the size request still serves the archive, labelled with no size: that request has a time limit", {
	skip,
}, () => {
	const t = run({ HANG_SIZE: "1" });
	release(t.github, "genuine");
	cpSync(t.github, t.mirror, { recursive: true });
	const result = t.go();
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout + result.stderr,
		/Downloading PrismaLens 0\.5\.6 for linux-x64 from downloads\.prismalens\.io\n/,
	);
	assert.equal(t.pl(), "genuine");
	assert.deepEqual(t.requests(), [
		`${GITHUB}/v0.5.6/SHA256SUMS plain`,
		`${MIRROR}/v0.5.6/${ARCHIVE} stall`,
	]);
});
