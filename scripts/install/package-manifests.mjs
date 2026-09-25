#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Writes the Homebrew formula and Scoop manifest for a release's standalone
// archives, hashes taken from its SHA256SUMS (#717).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const REPO = "prismalens/prismalens";
const DESCRIPTION =
	"Investigates a firing alert with your coding agent and returns ordered evidence";
const UNIX_TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const WINDOWS_TARGET = "win32-x64";

export function archiveName(version, target) {
	const ext = target.startsWith("win32") ? "zip" : "tar.gz";
	return `prismalens-${version}-${target}.${ext}`;
}

/** `sha256sum` output: `<hash>  <name>` or `<hash> *<name>` per line. */
export function parseSums(text) {
	const sums = new Map();
	for (const line of text.split(/\r?\n/)) {
		const match = /^([0-9a-fA-F]+)\s+\*?(.+)$/.exec(line.trim());
		if (match) sums.set(match[2], match[1].toLowerCase());
	}
	return sums;
}

function hashFor(sums, version, target, allowMissing) {
	const name = archiveName(version, target);
	const hash = sums.get(name);
	if (!hash && !allowMissing) throw new Error(`${name} is not in SHA256SUMS`);
	return hash;
}

export function formula({ version, baseUrl, sums, allowMissing = false }) {
	const block = (target) => {
		const hash = hashFor(sums, version, target, allowMissing);
		if (!hash) return null;
		return [
			`      url "${baseUrl}/${archiveName(version, target)}"`,
			`      sha256 "${hash}"`,
		].join("\n");
	};
	const osBlock = (os) => {
		const arm = block(`${os}-arm64`);
		const intel = block(`${os}-x64`);
		if (!arm && !intel) return null;
		const parts = [];
		if (arm) parts.push(`    on_arm do\n${arm}\n    end`);
		if (intel) parts.push(`    on_intel do\n${intel}\n    end`);
		return `  on_${os === "darwin" ? "macos" : "linux"} do\n${parts.join("\n")}\n  end`;
	};
	const platforms = ["darwin", "linux"].map(osBlock).filter(Boolean);
	return `class Prismalens < Formula
  desc "${DESCRIPTION}"
  homepage "https://prismalens.io"
  version "${version}"
  license "Apache-2.0"

${platforms.join("\n\n")}

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/pl", libexec/"bin/prismalens"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pl --version")
  end
end
`;
}

export function scoopManifest({
	version,
	baseUrl,
	sums,
	allowMissing = false,
}) {
	const hash = hashFor(sums, version, WINDOWS_TARGET, allowMissing);
	const releases = `https://github.com/${REPO}/releases/download`;
	return `${JSON.stringify(
		{
			version,
			description: DESCRIPTION,
			homepage: "https://prismalens.io",
			license: "Apache-2.0",
			architecture: {
				"64bit": {
					url: `${baseUrl}/${archiveName(version, WINDOWS_TARGET)}`,
					hash,
					extract_dir: `prismalens-${version}-${WINDOWS_TARGET}`,
				},
			},
			bin: [
				["bin\\pl.cmd", "pl"],
				["bin\\prismalens.cmd", "prismalens"],
			],
			checkver: { github: `https://github.com/${REPO}` },
			autoupdate: {
				architecture: {
					"64bit": {
						url: `${releases}/v$version/prismalens-$version-${WINDOWS_TARGET}.zip`,
						extract_dir: `prismalens-$version-${WINDOWS_TARGET}`,
					},
				},
				hash: { url: `${releases}/v$version/SHA256SUMS` },
			},
		},
		null,
		2,
	)}\n`;
}

function main() {
	const { values } = parseArgs({
		options: {
			version: { type: "string" },
			sums: { type: "string" },
			out: { type: "string" },
			"base-url": { type: "string" },
			"allow-missing": { type: "boolean", default: false },
		},
	});
	if (!values.version || !values.sums || !values.out) {
		throw new Error(
			"usage: package-manifests.mjs --version <v> --sums <SHA256SUMS> --out <dir> [--base-url <url>] [--allow-missing]",
		);
	}
	const version = values.version.replace(/^v/, "");
	const input = {
		version,
		baseUrl:
			values["base-url"] ??
			`https://github.com/${REPO}/releases/download/v${version}`,
		sums: parseSums(readFileSync(values.sums, "utf8")),
		allowMissing: values["allow-missing"],
	};
	const present = [...UNIX_TARGETS, WINDOWS_TARGET].filter((t) =>
		input.sums.has(archiveName(version, t)),
	);
	mkdirSync(join(values.out, "Formula"), { recursive: true });
	mkdirSync(join(values.out, "bucket"), { recursive: true });
	if (!input.allowMissing || present.some((t) => UNIX_TARGETS.includes(t))) {
		writeFileSync(join(values.out, "Formula", "prismalens.rb"), formula(input));
	}
	if (!input.allowMissing || present.includes(WINDOWS_TARGET)) {
		writeFileSync(
			join(values.out, "bucket", "prismalens.json"),
			scoopManifest(input),
		);
	}
	console.log(
		`==> manifests for ${version} (${present.join(", ")}) in ${values.out}`,
	);
}

if (process.argv[1]?.endsWith("package-manifests.mjs")) main();
