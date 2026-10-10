// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
	GIT_HOST_RULE,
	GitCredential,
	MACHINE_CREDENTIAL,
	helperName,
	hostFromGithubBaseUrl,
	isSshUrl,
	normalizeGitHost,
	repoPath,
	tokenFrom,
	tokenUsernameFor,
	urlHost,
} from "./git-credential.js";
import { gitConfigPairs, gitEnv, sshCommandFor } from "./git-env.js";
import {
	GitSpawnError,
	effectiveGitUrl,
	gitConfigRead,
	remoteGitEnv,
	spawnGit,
} from "./git-spawn.js";

describe("git-env", () => {
	it("T9a: strips trace, curl verbose, inherited config overrides, askpass, language and sets fail-fast defaults", () => {
		const parent: NodeJS.ProcessEnv = {
			PATH: "/usr/bin",
			HOME: "/home/user",
			GIT_ASKPASS: "/path/to/vscode/askpass.sh",
			SSH_ASKPASS: "/usr/bin/ssh-askpass",
			GIT_TRACE: "1",
			GIT_TRACE_PACKET: "1",
			GIT_CURL_VERBOSE: "1",
			GIT_CONFIG_COUNT: "2",
			GIT_CONFIG_KEY_0: "user.name",
			GIT_CONFIG_VALUE_0: "evil",
			GIT_CONFIG_PARAMETERS: "'user.email=evil@test'",
			LANGUAGE: "de_DE:de",
		};

		const env = gitEnv({
			source: "none",
			parent,
			wsl: false,
		});

		// Stripped keys
		expect(env.GIT_CURL_VERBOSE).toBeUndefined();
		expect(env.SSH_ASKPASS).toBeUndefined();
		expect(env.GIT_TRACE).toBeUndefined();
		expect(env.GIT_TRACE_PACKET).toBeUndefined();
		expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
		expect(env.LANGUAGE).toBeUndefined();

		// Preserved unrelated keys
		expect(env.PATH).toBe("/usr/bin");
		expect(env.HOME).toBe("/home/user");

		// Enforced fail-fast values
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.GIT_ASKPASS).toBe("");
		expect(env.SSH_ASKPASS_REQUIRE).toBe("never");
		expect(env.GCM_INTERACTIVE).toBe("never");
		expect(env.GIT_TRACE_REDACT).toBe("1");
		expect(env.LC_ALL).toBe("C");

		// Our own GIT_CONFIG_COUNT for source "none" (credential.helper="")
		expect(env.GIT_CONFIG_COUNT).toBe("1");
		expect(env.GIT_CONFIG_KEY_0).toBe("credential.helper");
		expect(env.GIT_CONFIG_VALUE_0).toBe("");
		expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
	});

	it("T9b: appends GCM_INTERACTIVE to WSLENV only under isWsl()", () => {
		const nonWsl = gitEnv({
			source: "machine",
			parent: { WSLENV: "FOO:BAR" },
			wsl: false,
		});
		expect(nonWsl.WSLENV).toBe("FOO:BAR");

		const wslWithExisting = gitEnv({
			source: "machine",
			parent: { WSLENV: "FOO:BAR" },
			wsl: true,
		});
		expect(wslWithExisting.WSLENV).toBe("FOO:BAR:GCM_INTERACTIVE");

		const wslWithoutExisting = gitEnv({
			source: "machine",
			parent: {},
			wsl: true,
		});
		expect(wslWithoutExisting.WSLENV).toBe("GCM_INTERACTIVE");
	});

	it("T10: preserves GIT_SSH untouched, appends BatchMode for OpenSSH, leaves plink unchanged", () => {
		// When GIT_SSH is set, GIT_SSH and GIT_SSH_COMMAND are left untouched
		const withGitSsh = gitEnv({
			source: "machine",
			parent: {
				GIT_SSH: "/usr/bin/plink",
				GIT_SSH_COMMAND: "custom-ssh-command",
			},
			wsl: false,
		});
		expect(withGitSsh.GIT_SSH).toBe("/usr/bin/plink");
		expect(withGitSsh.GIT_SSH_COMMAND).toBe("custom-ssh-command");

		// GIT_SSH set but GIT_SSH_COMMAND unset
		const withGitSshOnly = gitEnv({
			source: "machine",
			parent: {
				GIT_SSH: "/usr/bin/plink",
			},
			wsl: false,
		});
		expect(withGitSshOnly.GIT_SSH_COMMAND).toBeUndefined();

		// OpenSSH via GIT_SSH_COMMAND
		const openSshCmd = sshCommandFor({
			GIT_SSH_COMMAND: "ssh -i /path/key",
		});
		expect(openSshCmd).toBe(
			"ssh -i /path/key -o BatchMode=yes -o ConnectTimeout=15",
		);

		// OpenSSH via core.sshCommand
		const openSshCore = sshCommandFor({}, "ssh -i /path/key");
		expect(openSshCore).toBe(
			"ssh -i /path/key -o BatchMode=yes -o ConnectTimeout=15",
		);

		// Default fallback to "ssh"
		const defaultSsh = sshCommandFor({});
		expect(defaultSsh).toBe("ssh -o BatchMode=yes -o ConnectTimeout=15");

		// Non-OpenSSH: plink.exe
		const plink = sshCommandFor({}, "plink.exe -i key.ppk");
		expect(plink).toBe("plink.exe -i key.ppk");

		// Non-OpenSSH: tortoiseplink
		const tortoise = sshCommandFor({
			GIT_SSH_COMMAND: "/usr/bin/tortoiseplink -batch",
		});
		expect(tortoise).toBe("/usr/bin/tortoiseplink -batch");
	});

	it("T10b: config pairs per source", () => {
		// machine: no pairs
		expect(gitConfigPairs({ source: "machine" })).toEqual([]);

		// none: credential.helper="" only
		expect(gitConfigPairs({ source: "none" })).toEqual([
			["credential.helper", ""],
		]);

		// connection without authHeader or scope: credential.helper="" only
		expect(gitConfigPairs({ source: "connection" })).toEqual([
			["credential.helper", ""],
		]);

		// connection with authHeader and scope
		const pairs = gitConfigPairs({
			source: "connection",
			authHeader: "Authorization: Basic dGVzdA==",
			scope: "https://github.com/",
		});
		expect(pairs).toEqual([
			["credential.helper", ""],
			["http.extraheader", ""],
			["http.https://github.com/.extraheader", "Authorization: Basic dGVzdA=="],
		]);

		// Verify in gitEnv
		const env = gitEnv({
			source: "connection",
			authHeader: "Authorization: Basic dGVzdA==",
			scope: "https://github.com:8443",
			parent: {},
			wsl: false,
		});
		expect(env.GIT_CONFIG_COUNT).toBe("3");
		expect(env.GIT_CONFIG_KEY_0).toBe("credential.helper");
		expect(env.GIT_CONFIG_VALUE_0).toBe("");
		expect(env.GIT_CONFIG_KEY_1).toBe("http.extraheader");
		expect(env.GIT_CONFIG_VALUE_1).toBe("");
		expect(env.GIT_CONFIG_KEY_2).toBe(
			"http.https://github.com:8443/.extraheader",
		);
		expect(env.GIT_CONFIG_VALUE_2).toBe("Authorization: Basic dGVzdA==");
	});
});

describe("git-credential", () => {
	it("toJSON, util.inspect, spread, and JSON.stringify never print the secret token", () => {
		const cred = new GitCredential(
			{
				source: "connection",
				label: "token secret-lbl",
				via: "git-host-token",
				fingerprint: "12345678",
			},
			"ghp_super_secret_token_value_999",
			{ host: "github.com", effectiveUrl: "https://github.com/acme/repo.git" },
		);

		const serialized = JSON.stringify(cred);
		expect(serialized).not.toContain("ghp_super_secret_token_value_999");
		expect(serialized).toContain("secret-lbl");

		const inspected = inspect(cred);
		expect(inspected).not.toContain("ghp_super_secret_token_value_999");

		const json = cred.toJSON();
		expect(json).toEqual(cred.display);
		expect(JSON.stringify(json)).not.toContain(
			"ghp_super_secret_token_value_999",
		);

		const spread = { ...cred };
		expect(JSON.stringify(spread)).not.toContain(
			"ghp_super_secret_token_value_999",
		);

		expect(cred.key).toBe("connection:|git-host-token");
		expect(MACHINE_CREDENTIAL.display.source).toBe("machine");
	});

	it("tokenUsernameFor picks user per host", () => {
		expect(tokenUsernameFor("github.com")).toBe("x-access-token");
		expect(tokenUsernameFor("api.github.com")).toBe("x-access-token");
		expect(tokenUsernameFor("gitlab.com")).toBe("oauth2");
		expect(tokenUsernameFor("gitlab.example.org")).toBe("oauth2");
		expect(tokenUsernameFor("sub.gitlab.internal")).toBe("oauth2");
		expect(tokenUsernameFor("bitbucket.org")).toBe("x-token-auth");
		expect(tokenUsernameFor("selfhosted-git.corp")).toBe("x-access-token");
	});

	it("normalizeGitHost strips scheme, port rules, paths, userinfo", () => {
		expect(normalizeGitHost("github.com")).toBe("github.com");
		expect(normalizeGitHost("https://GitHub.com/")).toBe("github.com");
		expect(normalizeGitHost("https://gitlab.example.com:8443/repo.git")).toBe(
			"gitlab.example.com:8443",
		);
		expect(normalizeGitHost("http://localhost:3000")).toBe("localhost:3000");
		expect(normalizeGitHost("   GIT.CORP:9000/   ")).toBe("git.corp:9000");

		expect(normalizeGitHost("invalid_host!name")).toBeNull();
		expect(normalizeGitHost("")).toBeNull();
		expect(normalizeGitHost("http://")).toBeNull();
		expect(GIT_HOST_RULE).toContain("Host must be a hostname");
	});

	it("hostFromGithubBaseUrl maps api.github.com to github.com and preserves GHES host", () => {
		expect(hostFromGithubBaseUrl(undefined)).toBe("github.com");
		expect(hostFromGithubBaseUrl("")).toBe("github.com");
		expect(hostFromGithubBaseUrl("api.github.com")).toBe("github.com");
		expect(hostFromGithubBaseUrl("https://api.github.com")).toBe("github.com");
		expect(hostFromGithubBaseUrl("https://api.github.com/v3")).toBe("github.com");
		expect(hostFromGithubBaseUrl("https://ghe.corp/api/v3")).toBe("ghe.corp");
		expect(hostFromGithubBaseUrl("https://ghe.corp:8443/api/v3")).toBe(
			"ghe.corp:8443",
		);
		expect(hostFromGithubBaseUrl("not-a-valid-url")).toBe("github.com");
	});

	it("isSshUrl detects ssh:// and scp-style URLs", () => {
		expect(isSshUrl("ssh://git@github.com/org/repo.git")).toBe(true);
		expect(isSshUrl("git@github.com:org/repo.git")).toBe(true);
		expect(isSshUrl("user@host.xz:path/to/repo.git")).toBe(true);
		expect(isSshUrl("https://github.com/org/repo.git")).toBe(false);
		expect(isSshUrl("http://github.com/org/repo.git")).toBe(false);
		expect(isSshUrl("file:///tmp/repo.git")).toBe(false);
	});

	it("urlHost and repoPath extract components from http and scp URLs", () => {
		expect(urlHost("https://github.com/owner/repo.git")).toBe("github.com");
		expect(urlHost("https://gitlab.example.com:8443/owner/repo.git")).toBe(
			"gitlab.example.com:8443",
		);
		expect(urlHost("git@github.com:owner/repo.git")).toBe("github.com");
		expect(urlHost("ssh://git@git.corp:2222/owner/repo.git")).toBe(
			"git.corp:2222",
		);
		expect(urlHost("invalid-url-here")).toBeNull();

		expect(repoPath("https://github.com/owner/repo.git")).toBe("owner/repo");
		expect(repoPath("git@github.com:owner/repo.git")).toBe("owner/repo");
		expect(repoPath("git@github.com:owner/repo")).toBe("owner/repo");
		expect(repoPath("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
	});

	it("helperName extracts unquoted first token or returns null", () => {
		expect(helperName("!/usr/bin/gh auth git-credential")).toBe("gh");
		expect(helperName("manager")).toBe("manager");
		expect(helperName("cache --timeout=3600")).toBe("cache");
		expect(helperName("/usr/lib/git-core/git-credential-libsecret")).toBe(
			"git-credential-libsecret",
		);
		expect(helperName('"/mnt/c/Program Files/GCM"')).toBeNull();
		expect(helperName("\\escaped\\path")).toBeNull();
		expect(helperName("")).toBeNull();
	});

	it("tokenFrom searches credential keys in order", () => {
		expect(tokenFrom({ token: "t1", apiKey: "t2" })).toBe("t1");
		expect(tokenFrom({ accessToken: "t2" })).toBe("t2");
		expect(tokenFrom({ access_token: "t3" })).toBe("t3");
		expect(tokenFrom({ personalAccessToken: "t4" })).toBe("t4");
		expect(tokenFrom({ apiKey: "t5" })).toBe("t5");
		expect(tokenFrom({ other: "t6" })).toBeNull();
		expect(tokenFrom({})).toBeNull();
	});

	it("envInput produces appropriate GitEnvInput for GitCredential", () => {
		const cred = new GitCredential(
			{
				source: "connection",
				label: "token A",
				via: "git-host-token",
			},
			"my-secret",
			{ host: "github.com" },
		);

		const input = cred.envInput("https://github.com/owner/repo.git");
		expect(input.source).toBe("connection");
		expect(input.authHeader).toContain("Authorization: Basic ");
		expect(input.scope).toBe("https://github.com");

		// Non-matching host
		const inputOther = cred.envInput("https://gitlab.com/owner/repo.git");
		expect(inputOther.source).toBe("none");
		expect(inputOther.authHeader).toBeUndefined();

		// Machine credential envInput
		const machineInput = MACHINE_CREDENTIAL.envInput(
			"https://github.com/owner/repo.git",
		);
		expect(machineInput.source).toBe("machine");
	});
});

describe("git-spawn", () => {
	it("spawnGit runs git commands and captures stdout/stderr", async () => {
		const out = await spawnGit(["version"], {
			env: gitEnv({ source: "machine" }),
			timeoutMs: 5000,
		});
		expect(out.stdout).toContain("git version");
		expect(out.stderr).toBe("");
	});

	it("spawnGit feeds input to stdin and supports onStdoutLine", async () => {
		const lines: string[] = [];
		const out = await spawnGit(["hash-object", "--stdin"], {
			env: gitEnv({ source: "machine" }),
			timeoutMs: 5000,
			input: "hello world\n",
			onStdoutLine: (line) => lines.push(line.trim()),
		});
		expect(out.stdout).toBe("");
		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0]).toBe("3b18e512dba79e4c8300dd08aeb37f8e728b8dad");
	});

	it("spawnGit rejects on non-zero exit code with GitSpawnError", async () => {
		let failure: unknown;
		try {
			await spawnGit(["non-existent-subcommand-xyz"], {
				env: gitEnv({ source: "machine" }),
				timeoutMs: 5000,
			});
		} catch (err) {
			failure = err;
		}
		expect(failure).toBeInstanceOf(GitSpawnError);
		expect((failure as GitSpawnError).exitCode).not.toBe(0);
		expect((failure as GitSpawnError).timedOut).toBe(false);
	});

	it("spawnGit respects abort signal and aborts promptly", async () => {
		const controller = new AbortController();
		controller.abort(new Error("user aborted"));
		expect(() =>
			spawnGit(["version"], {
				env: gitEnv({ source: "machine" }),
				timeoutMs: 5000,
				signal: controller.signal,
			}),
		).toThrow("user aborted");
	});

	it("gitConfigRead reads git config outside any repo", async () => {
		const out = await gitConfigRead(["--version"]);
		expect(out.stdout).toContain("git version");
	});

	it("effectiveGitUrl expands insteadOf or falls back to URL", async () => {
		const url = "https://github.com/acme/repo.git";
		const effective = await effectiveGitUrl(url);
		expect(effective).toBe(url);

		// With invalid args or error, falls back to url
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fallback = await effectiveGitUrl("   ");
		expect(fallback).toBe("   ");
	});

	it("spawnGit times out on long running command", async () => {
		let failure: unknown;
		try {
			await spawnGit(["version"], {
				env: gitEnv({ source: "machine" }),
				timeoutMs: 0,
			});
		} catch (err) {
			failure = err;
		}
		expect(failure).toBeInstanceOf(GitSpawnError);
		expect((failure as GitSpawnError).timedOut).toBe(true);
	});

	it("spawnGit aborts during execution if signal fires after spawn", async () => {
		const controller = new AbortController();
		const p = spawnGit(["version"], {
			env: gitEnv({ source: "machine" }),
			timeoutMs: 5000,
			signal: controller.signal,
		});
		controller.abort(new Error("aborted mid-run"));
		await expect(p).rejects.toThrow("aborted mid-run");
	});

	it("remoteGitEnv queries coreSshCommand and includes it in gitEnv", async () => {
		const savedGitSsh = process.env.GIT_SSH;
		const savedGitSshCmd = process.env.GIT_SSH_COMMAND;
		delete process.env.GIT_SSH;
		delete process.env.GIT_SSH_COMMAND;
		try {
			const env = await remoteGitEnv({ source: "machine" });
			expect(env.GIT_SSH_COMMAND).toBeDefined();

			// Calling again within 30s reuses cached coreSshCommand
			const envCached = await remoteGitEnv({ source: "machine" });
			expect(envCached.GIT_SSH_COMMAND).toBe(env.GIT_SSH_COMMAND);

			// When GIT_SSH is set, coreSshCommand returns null early
			process.env.GIT_SSH = "/usr/bin/ssh";
			const envWithGitSsh = await remoteGitEnv({ source: "machine" });
			expect(envWithGitSsh.GIT_SSH).toBe("/usr/bin/ssh");
		} finally {
			if (savedGitSsh !== undefined) process.env.GIT_SSH = savedGitSsh;
			else delete process.env.GIT_SSH;
			if (savedGitSshCmd !== undefined)
				process.env.GIT_SSH_COMMAND = savedGitSshCmd;
			else delete process.env.GIT_SSH_COMMAND;
		}
	});
});
