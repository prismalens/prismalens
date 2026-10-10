// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	GitFailure,
	diagnoseGitFailure,
	formatDay,
	scrubGitStderr,
} from "./git-failure.js";

describe("git-failure", () => {
	it("GitFailure is an instance of Error with typed properties", () => {
		const failure = new GitFailure(
			"token-rejected",
			"github.com rejected token \"token A\" (fp 12345678). It was revoked or mistyped; replace it.",
			"replace-token",
			"fatal: Authentication failed for 'https://github.com/acme/repo.git/'",
		);
		expect(failure).toBeInstanceOf(Error);
		expect(failure.name).toBe("GitFailure");
		expect(failure.code).toBe("token-rejected");
		expect(failure.action).toBe("replace-token");
		expect(failure.stderr).toBe(
			"fatal: Authentication failed for 'https://github.com/acme/repo.git/'",
		);
	});

	it("scrubGitStderr redacts Authorization headers and embedded URL credentials", () => {
		const raw =
			"error: Authorization: Basic dXNlcjpzZWNyZXQ= failed\nfatal: unable to access 'https://user:password@github.com/org/repo.git': 401";
		const scrubbed = scrubGitStderr(raw);
		expect(scrubbed).not.toContain("Basic dXNlcjpzZWNyZXQ=");
		expect(scrubbed).not.toContain("user:password");
		expect(scrubbed).toContain("Authorization: ***");
		expect(scrubbed).toContain("https://***@github.com/org/repo.git");
	});

	it("formatDay formats Date to YYYY-MM-DD", () => {
		const d = new Date("2026-10-15T12:00:00Z");
		expect(formatDay(d)).toBe("2026-10-15");
	});

	describe("taxonomy table classification", () => {
		const now = new Date("2026-10-10T20:00:00Z");

		it("classifies token-expired when tokenExpiresAt < now for source connection", () => {
			const res = diagnoseGitFailure({
				stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
				credential: {
					source: "connection",
					label: "token A",
					via: "git-host-token",
					fingerprint: "12345678",
				},
				host: "github.com",
				repo: "acme/repo",
				tokenExpiresAt: new Date("2026-10-01T00:00:00Z"),
				sshAuthSockSet: true,
				now,
			});
			expect(res.code).toBe("token-expired");
			expect(res.action).toBe("replace-token");
			expect(res.message).toBe(
				'Token "A" expired on 2026-10-01. Replace it in Settings → Integrations.',
			);
		});

		it("classifies token-rejected on 'could not read Username' or 'Authentication failed for'", () => {
			// Fixture from D9 local server 401 with helper reset:
			const stderr401 =
				"fatal: could not read Username for 'https://127.0.0.1:8443/repo.git': terminal prompts disabled";
			const res1 = diagnoseGitFailure({
				stderr: stderr401,
				credential: {
					source: "connection",
					label: "token gh-pat",
					via: "git-host-token",
					fingerprint: "a1b2c3d4",
				},
				host: "127.0.0.1:8443",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res1.code).toBe("token-rejected");
			expect(res1.action).toBe("replace-token");
			expect(res1.message).toBe(
				'127.0.0.1:8443 rejected token "gh-pat" (fp a1b2c3d4). It was revoked or mistyped; replace it.',
			);

			// Authentication failed for (e.g. GitHub after redirect)
			const stderrAuthFail =
				"remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/acme/repo.git/'";
			const res2 = diagnoseGitFailure({
				stderr: stderrAuthFail,
				credential: {
					source: "connection",
					label: "token gh-pat",
					via: "git-host-token",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res2.code).toBe("token-rejected");
			expect(res2.action).toBe("replace-token");
			expect(res2.message).toBe(
				'github.com rejected token "gh-pat". It was revoked or mistyped; replace it.',
			);
		});

		it("classifies no-access for connection on 403 or repository not found", () => {
			// curl's returned error: 403
			const stderr403 =
				"fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403";
			const res1 = diagnoseGitFailure({
				stderr: stderr403,
				credential: {
					source: "connection",
					label: "token A",
					via: "git-host-token",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res1.code).toBe("no-access");
			expect(res1.action).toBe("replace-token");
			expect(res1.message).toBe(
				"Token \"A\" can't see acme/repo: it doesn't exist or the token has no access to it. Check the URL or grant the repository on the token.",
			);

			// GitHub 404 (S4 fixture / repository not found)
			const stderr404 =
				"remote: Repository not found.\nfatal: repository 'https://github.com/prismalens-fixtures/clone-outside.git/' not found";
			const res2 = diagnoseGitFailure({
				stderr: stderr404,
				credential: {
					source: "connection",
					label: "token A",
					via: "git-host-token",
				},
				host: "github.com",
				repo: "prismalens-fixtures/clone-outside",
				sshAuthSockSet: true,
				now,
			});
			expect(res2.code).toBe("no-access");
			expect(res2.action).toBe("replace-token");
		});

		it("classifies machine-rejected on Authentication failed for or 403", () => {
			const stderrAuth =
				"remote: Authentication failed\nfatal: Authentication failed for 'https://github.com/acme/repo.git/'";
			const res1 = diagnoseGitFailure({
				stderr: stderrAuth,
				credential: {
					source: "machine",
					label: "machine git (gh, sumit)",
					via: "!gh auth git-credential",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res1.code).toBe("machine-rejected");
			expect(res1.action).toBe("add-credential");
			expect(res1.message).toBe(
				"github.com refused your machine's git (gh, sumit). Sign in again, or add a Git host token.",
			);

			// machine with label without parentheses
			const res2 = diagnoseGitFailure({
				stderr:
					"fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403",
				credential: {
					source: "machine",
					label: "machine git",
					via: "git",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res2.code).toBe("machine-rejected");
			expect(res2.message).toBe(
				"github.com refused your machine's git. Sign in again, or add a Git host token.",
			);
		});

		it("classifies no-credential on could not read Username for machine or none", () => {
			const stderr =
				"fatal: could not read Username for 'https://github.com': terminal prompts disabled";
			const resNone = diagnoseGitFailure({
				stderr,
				credential: {
					source: "none",
					label: "public",
					via: "none",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(resNone.code).toBe("no-credential");
			expect(resNone.action).toBe("add-credential");
			expect(resNone.message).toBe(
				"No credential for github.com. Add a Git host token in Settings → Integrations, or sign your machine's git in to github.com.",
			);

			const resMachine = diagnoseGitFailure({
				stderr,
				credential: {
					source: "machine",
					label: "machine git",
					via: "git",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(resMachine.code).toBe("no-credential");
			expect(resMachine.action).toBe("add-credential");
		});

		it("classifies ssh-host-key on Host key verification failed", () => {
			const stderr =
				"Host key verification failed.\nfatal: Could not read from remote repository.";
			const res = diagnoseGitFailure({
				stderr,
				credential: {
					source: "machine",
					label: "machine git (ssh keys)",
					via: "ssh keys",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res.code).toBe("ssh-host-key");
			expect(res.action).toBeUndefined();
			expect(res.message).toBe(
				"github.com's SSH host key is not trusted yet. Run `ssh -T git@github.com` once as the user that runs PrismaLens, or use an HTTPS URL with a token.",
			);
		});

		it("classifies ssh-key-refused with or without ssh agent reachable", () => {
			const stderr =
				"git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";

			// S9 scenario: background service with no SSH agent
			const resNoAgent = diagnoseGitFailure({
				stderr,
				credential: {
					source: "machine",
					label: "machine git (ssh keys)",
					via: "ssh keys",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: false,
				now,
			});
			expect(resNoAgent.code).toBe("ssh-key-refused");
			expect(resNoAgent.message).toBe(
				"github.com refused your SSH key. No SSH agent is reachable from the server (a background service has none); use an HTTPS URL with a token.",
			);

			// Normal shell with agent reachable
			const resWithAgent = diagnoseGitFailure({
				stderr,
				credential: {
					source: "machine",
					label: "machine git (ssh keys)",
					via: "ssh keys",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(resWithAgent.code).toBe("ssh-key-refused");
			expect(resWithAgent.message).toBe("github.com refused your SSH key.");
		});

		it("classifies not-found for machine or none", () => {
			const stderr404 =
				"remote: Repository not found.\nfatal: repository 'https://github.com/acme/private-repo.git/' not found";
			const res = diagnoseGitFailure({
				stderr: stderr404,
				credential: {
					source: "none",
					label: "public",
					via: "none",
				},
				host: "github.com",
				repo: "acme/private-repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res.code).toBe("not-found");
			expect(res.action).toBe("add-credential");
			expect(res.message).toBe(
				"acme/private-repo was not found or is private. Check the URL or add a credential for github.com.",
			);

			const stderrReturned404 =
				"fatal: unable to access 'https://example.com/repo.git/': The requested URL returned error: 404";
			const res2 = diagnoseGitFailure({
				stderr: stderrReturned404,
				credential: {
					source: "machine",
					label: "machine git",
					via: "git",
				},
				host: "example.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res2.code).toBe("not-found");
		});

		it("T12b: unable to access ... returned error: 403 is no-access / machine-rejected, not unreachable", () => {
			const stderr403 =
				"fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403";

			const resConn = diagnoseGitFailure({
				stderr: stderr403,
				credential: {
					source: "connection",
					label: "token A",
					via: "git-host-token",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(resConn.code).toBe("no-access");

			const resMachine = diagnoseGitFailure({
				stderr: stderr403,
				credential: {
					source: "machine",
					label: "machine git",
					via: "git",
				},
				host: "github.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(resMachine.code).toBe("machine-rejected");
		});

		it("classifies unreachable on network connection failures", () => {
			const tests = [
				"fatal: unable to access 'https://github.com/repo.git/': Could not resolve host: github.com",
				"fatal: unable to access 'https://192.0.2.1/repo.git/': Failed to connect to 192.0.2.1 port 443: Connection refused",
				"fatal: unable to access 'https://192.0.2.1/repo.git/': Connection timed out",
				"fatal: unable to access 'https://192.0.2.1/repo.git/': Operation timed out after 30000 milliseconds",
				"ssh: connect to host git.corp port 22: Connection refused\nfatal: Could not read from remote repository.",
			];

			for (const stderr of tests) {
				const res = diagnoseGitFailure({
					stderr,
					credential: {
						source: "none",
						label: "public",
						via: "none",
					},
					host: "example.com",
					repo: "acme/repo",
					sshAuthSockSet: true,
					now,
				});
				expect(res.code).toBe("unreachable");
				expect(res.message).toMatch(/^Could not reach example\.com: /);
			}
		});

		it("classifies other on unexpected stderr", () => {
			const stderr = "fatal: some internal git error occurred\nmore details";
			const res = diagnoseGitFailure({
				stderr,
				credential: {
					source: "none",
					label: "public",
					via: "none",
				},
				host: "example.com",
				repo: "acme/repo",
				sshAuthSockSet: true,
				now,
			});
			expect(res.code).toBe("other");
			expect(res.message).toBe("fatal: some internal git error occurred");
		});
	});
});
