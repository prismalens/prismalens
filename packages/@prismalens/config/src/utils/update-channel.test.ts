// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	effectiveUpdateChannel,
	isUpdateChannel,
	leavingNightlyNote,
	nightlyBlockedBy,
	readUpdateChannel,
	writeUpdateChannel,
} from "./update-channel.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`prismalens-update-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("isUpdateChannel", () => {
	it("recognizes valid channel values", () => {
		expect(isUpdateChannel("stable")).toBe(true);
		expect(isUpdateChannel("nightly")).toBe(true);
		expect(isUpdateChannel("beta")).toBe(false);
		expect(isUpdateChannel(null)).toBe(false);
		expect(isUpdateChannel(123)).toBe(false);
	});
});

describe("readUpdateChannel", () => {
	it("returns stable when no file exists", () => {
		const dir = makeTmpDir();
		try {
			expect(readUpdateChannel(dir, {})).toBe("stable");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns nightly when the channel file specifies nightly", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(
				join(dir, "update-channel.json"),
				JSON.stringify({ channel: "nightly" }),
				"utf8",
			);
			expect(readUpdateChannel(dir, {})).toBe("nightly");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns stable on corrupt file or invalid channel like beta", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(join(dir, "update-channel.json"), "{not-json", "utf8");
			expect(readUpdateChannel(dir, {})).toBe("stable");

			writeFileSync(
				join(dir, "update-channel.json"),
				JSON.stringify({ channel: "beta" }),
				"utf8",
			);
			expect(readUpdateChannel(dir, {})).toBe("stable");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lets PRISMALENS_UPDATE_CHANNEL override a stable file", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(
				join(dir, "update-channel.json"),
				JSON.stringify({ channel: "stable" }),
				"utf8",
			);
			expect(
				readUpdateChannel(dir, { PRISMALENS_UPDATE_CHANNEL: "Nightly" }),
			).toBe("nightly");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("falls through to the file when PRISMALENS_UPDATE_CHANNEL is invalid", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(
				join(dir, "update-channel.json"),
				JSON.stringify({ channel: "nightly" }),
				"utf8",
			);
			expect(
				readUpdateChannel(dir, { PRISMALENS_UPDATE_CHANNEL: "invalid" }),
			).toBe("nightly");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("writeUpdateChannel", () => {
	it("round-trips with readUpdateChannel and writes exact JSON format with newline", () => {
		const dir = makeTmpDir();
		try {
			writeUpdateChannel(dir, "nightly");
			expect(readUpdateChannel(dir, {})).toBe("nightly");

			const fs = require("node:fs");
			const content = fs.readFileSync(join(dir, "update-channel.json"), "utf8");
			expect(content).toBe('{"channel":"nightly"}\n');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates a workspace that doesn't exist yet and writes the channel into it", () => {
		const root = mkdtempSync(join(tmpdir(), "pl-channel-new-"));
		const workspace = join(root, "not-yet", "workspace");
		try {
			writeUpdateChannel(workspace, "nightly");
			expect(
				readFileSync(join(workspace, "update-channel.json"), "utf8"),
			).toBe('{"channel":"nightly"}\n');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("throws EEXIST when the workspace path is a file", () => {
		const root = mkdtempSync(join(tmpdir(), "pl-channel-file-"));
		const file = join(root, "a-file");
		writeFileSync(file, "x");
		try {
			expect(() => writeUpdateChannel(file, "nightly")).toThrow(/EEXIST/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("nightlyBlockedBy", () => {
	it("returns null for npm and not_npm for other install channels", () => {
		expect(nightlyBlockedBy("npm")).toBe(null);
		expect(nightlyBlockedBy("installer")).toBe("not_npm");
		expect(nightlyBlockedBy("homebrew")).toBe("not_npm");
		expect(nightlyBlockedBy("scoop")).toBe("not_npm");
		expect(nightlyBlockedBy("electron")).toBe("not_npm");
	});
});

describe("effectiveUpdateChannel", () => {
	it("maps saved nightly to stable for installer and nightly for npm", () => {
		const dir = makeTmpDir();
		try {
			writeUpdateChannel(dir, "nightly");
			expect(effectiveUpdateChannel(dir, "installer", {})).toBe("stable");
			expect(effectiveUpdateChannel(dir, "npm", {})).toBe("nightly");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("leavingNightlyNote", () => {
	it("returns null when current is not a prerelease", () => {
		expect(leavingNightlyNote("0.5.3", "0.5.2")).toBe(null);
	});

	it("returns null when current is nightly and stable is newer", () => {
		expect(leavingNightlyNote("0.5.4-nightly.20261111.7", "0.5.4")).toBe(null);
	});

	it("returns the exact warning string when stable is older", () => {
		const note = leavingNightlyNote("0.5.4-nightly.20261111.7", "0.5.3");
		expect(note).toBe(
			"You're on nightly 0.5.4-nightly.20261111.7 and stable 0.5.3 is older. A nightly may have migrated your workspace past an older release, so this install stays on 0.5.4-nightly.20261111.7 and moves to stable when 0.5.4 or later ships.",
		);
	});

	it("returns the exact warning string without the stable comparison when stable is null", () => {
		const note = leavingNightlyNote("0.5.4-nightly.20261111.7", null);
		expect(note).toBe(
			"You're on nightly 0.5.4-nightly.20261111.7. A nightly may have migrated your workspace past an older release, so this install stays on 0.5.4-nightly.20261111.7 and moves to stable when 0.5.4 or later ships.",
		);
	});
});
