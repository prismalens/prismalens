import { describe, expect, it } from "vitest";
import { type Allowlist, checkCommand } from "./shell-exec.js";

const allow: Allowlist = {
	commands: {
		kubectl: { subcommands: ["get", "logs", "describe"] },
		journalctl: {},
	},
};

describe("checkCommand — read-only allowlist (deny by default)", () => {
	it("allows an allowlisted command + subcommand", () => {
		expect(checkCommand(allow, "kubectl", ["get", "pods"])).toBeNull();
	});

	it("denies a binary not in the allowlist", () => {
		expect(checkCommand(allow, "rm", ["-rf", "/"])).toMatch(/not in the read-only allowlist/);
	});

	it("denies a non-allowed (but non-mutating) subcommand", () => {
		expect(checkCommand(allow, "kubectl", ["api-versions"])).toMatch(/not an allowed read-only subcommand/);
	});

	it("rejects a mutating verb anywhere, even on an unrestricted binary", () => {
		expect(checkCommand(allow, "journalctl", ["delete"])).toMatch(/mutating/);
	});

	it("rejects a --force style flag (dash-stripped match)", () => {
		expect(checkCommand(allow, "kubectl", ["get", "--force"])).toMatch(/mutating/);
	});

	it("rejects shell metacharacters", () => {
		expect(checkCommand(allow, "kubectl", ["get", "pods;reboot"])).toMatch(/metacharacter/);
	});

	it("rejects when a subcommand is required but none is given", () => {
		expect(checkCommand(allow, "kubectl", [])).toMatch(/not an allowed read-only subcommand/);
	});
});
