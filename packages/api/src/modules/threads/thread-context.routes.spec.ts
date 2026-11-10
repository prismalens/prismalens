// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCESS_SCOPE } from "@prismalens/auth";
import { DEFAULT_THREAD_CONTEXT_SETTINGS } from "@prismalens/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { RepositoriesController } from "../repositories/repositories.controller.js";
import { RunWorkspacesController } from "../run-workspaces/run-workspaces.controller.js";
import { RunWorkspaceNotFoundError } from "../run-workspaces/run-workspaces.service.js";
import { ThreadContextSettingsController } from "./thread-context-settings.controller.js";
import {
	readThreadContextSettings,
	writeThreadContextSettings,
} from "./thread-context-settings.js";
import { ThreadsController } from "./threads.controller.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const PR = "22222222-2222-4222-8222-222222222222";
const request = (host: boolean) => ({
	operator: { device: { scopes: host ? [ACCESS_SCOPE] : [] } },
});
type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: unknown }) => unknown };
};
const call = (r: unknown, input: unknown, host = true) =>
	(r as Callable)["~orpc"].handler({ input, context: { request: request(host) } });

const dir = mkdtempSync(join(tmpdir(), "pl-routes-"));
writeFileSync(join(dir, "justfile"), "fmt:\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("thread context routes (#1024)", () => {
	it("hands each route to its service, with whether the viewer is the host", async () => {
		const context = { context: vi.fn(async () => ({ kind: "none" })) };
		const prs = {
			list: vi.fn(async () => ({ pullRequests: [], statusEnabled: true })),
			linkFromUser: vi.fn(async () => ({ id: PR })),
			unlink: vi.fn(async () => true),
		};
		const links = { resolve: vi.fn(async () => [null]) };
		const routes = new ThreadsController(
			{} as never,
			{} as never,
			context as never,
			prs as never,
			links as never,
		).routes();
		await call(routes.context, { id: RUN }, false);
		expect(context.context).toHaveBeenCalledWith(RUN, false);
		await call(routes.pullRequests, { id: RUN });
		expect(prs.list).toHaveBeenCalledWith(RUN);
		await call(routes.refreshPullRequests, { id: RUN });
		expect(prs.list).toHaveBeenLastCalledWith(RUN, { force: true });
		await call(routes.linkPullRequest, { id: RUN, url: "https://github.com/a/b/pull/1" });
		expect(prs.linkFromUser).toHaveBeenCalledWith(RUN, "https://github.com/a/b/pull/1");
		await expect(call(routes.unlinkPullRequest, { id: RUN, prId: PR })).resolves.toEqual({
			removed: true,
		});
		await expect(
			call(routes.resolveLinks, { id: RUN, candidates: [{ kind: "path", text: "a" }] }),
		).resolves.toEqual({ targets: [null] });
	});
});

describe("thread context settings", () => {
	function store() {
		const rows = new Map<string, { value: string }>();
		return {
			setting: {
				findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
					const r = rows.get(where.key);
					return r ? { key: where.key, ...r } : null;
				}),
				upsert: vi.fn(
					async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
						rows.set(where.key, { value: create.value });
					},
				),
			},
			rows,
		};
	}

	it("reads the defaults, a stored value, and a broken row as the defaults", async () => {
		const db = store();
		expect(await readThreadContextSettings(db as never)).toEqual(
			DEFAULT_THREAD_CONTEXT_SETTINGS,
		);
		await writeThreadContextSettings(db as never, { prStatus: false, editor: "zed" });
		expect(await readThreadContextSettings(db as never)).toEqual({
			prStatus: false,
			editor: "zed",
		});
		db.rows.set("threads.context", { value: "{" });
		expect(await readThreadContextSettings(db as never)).toEqual(
			DEFAULT_THREAD_CONTEXT_SETTINGS,
		);
	});

	it("lists editors, and lets only the host change the settings", async () => {
		const db = store();
		const c = new ThreadContextSettingsController(db as never);
		const editors = (await call(c.editors().list, undefined)) as { editors: unknown[] };
		expect(Array.isArray(editors.editors)).toBe(true);
		const routes = c.threadContext();
		const next = { prStatus: false, editor: "system" };
		await expect(call(routes.update, next, false)).rejects.toThrow(/Only the owner can/);
		await expect(call(routes.update, next, true)).resolves.toEqual(next);
		await expect(call(routes.get, undefined)).resolves.toEqual(next);
	});
});

describe("open in editor and project scripts routes", () => {
	it("opens in an editor only from the host, and 404s what the service cannot find", async () => {
		const service = {
			openInEditor: vi
				.fn()
				.mockResolvedValueOnce({ opened: true, editor: "vscode" })
				.mockRejectedValueOnce(new RunWorkspaceNotFoundError("No such file")),
		};
		const procs = new RunWorkspacesController(service as never).runWorkspaces();
		const input = { id: RUN, path: "a.ts", line: 3 };
		await expect(call(procs.openInEditor, input, false)).rejects.toThrow(
			/Only the owner can/,
		);
		await expect(call(procs.openInEditor, input)).resolves.toEqual({
			opened: true,
			editor: "vscode",
		});
		await expect(call(procs.openInEditor, input)).rejects.toThrow("No such file");
	});

	it("lists a folder project's scripts, none for a git URL, and 404s an unknown one", async () => {
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ sourceKind: "folder", url: dir, subPath: null })
			.mockResolvedValueOnce({ sourceKind: "url", url: "https://github.com/a/b" })
			.mockResolvedValueOnce(null);
		const routes = new RepositoriesController({ findById } as never, {} as never).repositories();
		await expect(call(routes.scripts, { id: RUN })).resolves.toEqual({
			scripts: [{ runner: "just", name: "fmt", command: "just fmt" }],
		});
		await expect(call(routes.scripts, { id: RUN })).resolves.toEqual({ scripts: [] });
		await expect(call(routes.scripts, { id: RUN })).rejects.toThrow(/not found/);
	});
});
