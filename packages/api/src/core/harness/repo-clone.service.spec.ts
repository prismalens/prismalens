// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * RepoCloneService puts the investigated repo under the app-data dir so the
 * harness cwd is never the user's own checkout (ADR 0004 §2, #597 slice 3).
 * Two properties here are security-relevant and worth pinning: a token is sent
 * as a per-command header (never written into the clone's config, never in the
 * URL), and it is only attached to HTTPS remotes. `git` itself is mocked — these
 * assertions are about the argv the service builds, not about git's behaviour.
 */
import { join } from "node:path";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: (...args: unknown[]) => existsSyncMock(...args),
		mkdirSync: vi.fn(),
	};
});

const existsSyncMock = vi.fn();

const { RepoCloneService, clonePathFor } = await import(
	"./repo-clone.service.js"
);

/**
 * `promisify(execFile)` calls the callback form, so the double answers the
 * node-style callback with a `{ stdout, stderr }` result.
 */
function gitSucceeds(stdout = "") {
	execFileMock.mockImplementation((...args: unknown[]) => {
		const cb = args[args.length - 1] as (
			err: Error | null,
			out: { stdout: string; stderr: string },
		) => void;
		cb(null, { stdout, stderr: "" });
	});
}

/** The argv of every `git` invocation the service made. */
function gitCalls(): string[][] {
	return execFileMock.mock.calls.map((c) => c[1] as string[]);
}

describe("clonePathFor", () => {
	it("lays the clone out by host, then owner, then name", () => {
		expect(clonePathFor("https://github.com/acme/widgets", "/root")).toBe(
			join("/root", "github.com", "acme", "widgets"),
		);
	});

	it("drops a trailing .git", () => {
		expect(clonePathFor("https://github.com/acme/widgets.git", "/root")).toBe(
			join("/root", "github.com", "acme", "widgets"),
		);
	});

	it("normalises an scp-style git@ remote to the same path as its https twin", () => {
		expect(clonePathFor("git@github.com:acme/widgets.git", "/root")).toBe(
			clonePathFor("https://github.com/acme/widgets.git", "/root"),
		);
	});

	it("keeps a self-hosted host and a nested group path distinct", () => {
		expect(
			clonePathFor("https://git.example.com/group/sub/app", "/root"),
		).toBe(join("/root", "git.example.com", "group", "sub", "app"));
	});

	it("never escapes the root, whatever the path segments look like", () => {
		for (const url of [
			"https://github.com/../../etc/passwd",
			"https://github.com/%2e%2e/%2e%2e/etc",
			"https://github.com/a b/c;d",
		]) {
			const path = clonePathFor(url, "/root");
			expect(path.startsWith(join("/root", "github.com"))).toBe(true);
			expect(path.split("/")).not.toContain("..");
		}
	});
});

describe("RepoCloneService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		existsSyncMock.mockReturnValue(false);
		gitSucceeds("cafebabe1234\n");
	});

	it("clones on first sight and reports the resolved head", async () => {
		const result = await new RepoCloneService().ensureClone({
			url: "https://github.com/acme/widgets",
		});

		expect(result.action).toBe("cloned");
		expect(result.head).toBe("cafebabe1234");
		expect(gitCalls()[0]).toContain("clone");
	});

	it("fetches and force-detaches instead of re-cloning an existing checkout", async () => {
		existsSyncMock.mockReturnValue(true);

		const result = await new RepoCloneService().ensureClone({
			url: "https://github.com/acme/widgets",
			defaultBranch: "main",
		});

		expect(result.action).toBe("updated");
		const argvs = gitCalls();
		expect(argvs.some((a) => a.includes("fetch"))).toBe(true);
		expect(argvs.some((a) => a.includes("clone"))).toBe(false);
		// The branch is checked out from the remote, never from a stale local ref.
		expect(argvs.find((a) => a.includes("checkout"))).toContain("origin/main");
	});

	it("clones the requested default branch", async () => {
		await new RepoCloneService().ensureClone({
			url: "https://github.com/acme/widgets",
			defaultBranch: "trunk",
		});

		const clone = gitCalls().find((a) => a.includes("clone")) as string[];
		expect(clone).toContain("--branch");
		expect(clone[clone.indexOf("--branch") + 1]).toBe("trunk");
	});

	it("ignores a whitespace-only default branch rather than cloning branch ''", async () => {
		await new RepoCloneService().ensureClone({
			url: "https://github.com/acme/widgets",
			defaultBranch: "   ",
		});

		expect(gitCalls().find((a) => a.includes("clone"))).not.toContain(
			"--branch",
		);
	});

	describe("token handling", () => {
		const token = "ghs_secret_token_value";

		it("sends the token as a per-command header, not in the URL or config", async () => {
			await new RepoCloneService().ensureClone({
				url: "https://github.com/acme/widgets",
				token,
			});

			const clone = gitCalls().find((a) => a.includes("clone")) as string[];
			expect(clone[0]).toBe("-c");
			expect(clone[1]).toMatch(/^http\.extraheader=Authorization: Basic /);

			// The credential rides `-c`, so it never lands in the clone's config...
			expect(clone).not.toContain("config");
			// ...and never appears in the remote URL.
			expect(clone.find((a) => a.startsWith("https://"))).toBe(
				"https://github.com/acme/widgets",
			);
			expect(
				clone.filter((a) => a.includes(token)).length,
				"the raw token must never be passed verbatim",
			).toBe(0);
		});

		it("encodes the token as basic auth under the x-access-token user", async () => {
			await new RepoCloneService().ensureClone({
				url: "https://github.com/acme/widgets",
				token,
			});

			const header = (
				gitCalls().find((a) => a.includes("clone")) as string[]
			)[1];
			const encoded = header.replace(
				"http.extraheader=Authorization: Basic ",
				"",
			);
			expect(Buffer.from(encoded, "base64").toString()).toBe(
				`x-access-token:${token}`,
			);
		});

		it("does not attach a token to an ssh remote, which cannot consume it", async () => {
			await new RepoCloneService().ensureClone({
				url: "git@github.com:acme/widgets.git",
				token,
			});

			for (const argv of gitCalls()) expect(argv).not.toContain("-c");
		});

		it("attaches nothing when the token is absent or blank", async () => {
			await new RepoCloneService().ensureClone({
				url: "https://github.com/acme/widgets",
				token: "   ",
			});

			for (const argv of gitCalls()) expect(argv).not.toContain("-c");
		});
	});

	describe("concurrency", () => {
		it("shares one operation between concurrent callers for the same repo", async () => {
			const service = new RepoCloneService();
			const target = { url: "https://github.com/acme/widgets" };

			const [a, b] = await Promise.all([
				service.ensureClone(target),
				service.ensureClone(target),
			]);

			expect(a).toEqual(b);
			expect(gitCalls().filter((c) => c.includes("clone")).length).toBe(1);
		});

		it("runs a second clone after the first settles, rather than caching it forever", async () => {
			const service = new RepoCloneService();
			const target = { url: "https://github.com/acme/widgets" };

			await service.ensureClone(target);
			await service.ensureClone(target);

			expect(gitCalls().filter((c) => c.includes("clone")).length).toBe(2);
		});

		it("releases the in-flight slot when the operation fails", async () => {
			execFileMock.mockImplementationOnce((...args: unknown[]) => {
				const cb = args[args.length - 1] as (err: Error) => void;
				cb(new Error("network unreachable"));
			});
			const service = new RepoCloneService();
			const target = { url: "https://github.com/acme/widgets" };

			await expect(service.ensureClone(target)).rejects.toThrow(
				/network unreachable/,
			);

			// A failed clone must not poison the map — the retry has to reach git.
			gitSucceeds("deadbeef\n");
			await expect(service.ensureClone(target)).resolves.toMatchObject({
				head: "deadbeef",
			});
		});

		it("does not share an operation between different repos", async () => {
			const service = new RepoCloneService();

			await Promise.all([
				service.ensureClone({ url: "https://github.com/acme/one" }),
				service.ensureClone({ url: "https://github.com/acme/two" }),
			]);

			expect(gitCalls().filter((c) => c.includes("clone")).length).toBe(2);
		});
	});
});
