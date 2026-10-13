// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { isolateService, UNIT } from "./gate-service-sandbox.mjs";

const root = mkdtempSync(join(tmpdir(), "gate-service-sandbox-"));
after(() => rmSync(root, { recursive: true, force: true }));

function setup() {
	const dir = mkdtempSync(join(root, "case-"));
	const tools = join(dir, "tools");
	mkdirSync(tools);
	const calls = join(dir, "calls");
	const fake = join(dir, "real systemctl");
	writeFileSync(fake, `#!/bin/sh\necho "$*" >> '${calls}'\n`, { mode: 0o755 });
	const iso = isolateService({
		configHome: join(dir, "config"),
		runtimeDir: join(dir, "run"),
		tools,
		systemctl: fake,
	});
	return { dir, tools, calls, iso };
}

test("the unit file stays in the throwaway config; the manager reaches it by a runtime link", () => {
	const { dir, iso } = setup();
	assert.equal(iso.unitPath, join(dir, "config", "systemd", "user", UNIT));
	assert.equal(
		readlinkSync(join(dir, "run", "systemd", "user", UNIT)),
		iso.unitPath,
	);
});

test("a runtime drop-in caps the unit's memory with no swap", () => {
	const { dir } = setup();
	const conf = readFileSync(
		join(dir, "run", "systemd", "user", `${UNIT}.d`, "50-gate-memory.conf"),
		"utf8",
	);
	assert.match(conf, /^\[Service\]\nMemoryMax=\d+M\nMemorySwapMax=0\n$/);
});

test("the shim adds --runtime to enable and disable only", () => {
	const { tools, calls } = setup();
	const ctl = join(tools, "systemctl");
	execFileSync(ctl, ["--user", "enable", UNIT]);
	execFileSync(ctl, ["--user", "disable", "--now", UNIT]);
	execFileSync(ctl, ["--user", "is-enabled", UNIT]);
	execFileSync(ctl, ["--user", "restart", UNIT]);
	assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), [
		`--user enable ${UNIT} --runtime`,
		`--user disable --now ${UNIT} --runtime`,
		`--user is-enabled ${UNIT}`,
		`--user restart ${UNIT}`,
	]);
});

test("remove() takes the link, the drop-in and a runtime wants link away", () => {
	const { dir, iso } = setup();
	const unitDir = join(dir, "run", "systemd", "user");
	mkdirSync(join(unitDir, "default.target.wants"));
	writeFileSync(join(unitDir, "default.target.wants", UNIT), "");
	iso.remove();
	assert.equal(existsSync(join(unitDir, UNIT)), false);
	assert.equal(existsSync(join(unitDir, `${UNIT}.d`)), false);
	assert.equal(existsSync(join(unitDir, "default.target.wants", UNIT)), false);
});

test("a second check on the same runtime dir fails and leaves the first one's link (#834 review)", () => {
	const { dir, tools, iso } = setup();
	const link = join(dir, "run", "systemd", "user", UNIT);
	assert.throws(
		() =>
			isolateService({
				configHome: join(dir, "other-config"),
				runtimeDir: join(dir, "run"),
				tools,
				systemctl: "/bin/true",
			}),
		/another gate check holds the service/,
	);
	assert.equal(readlinkSync(link), iso.unitPath);
});
