// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_SCOPE } from "@prismalens/auth";
import { describe, expect, it, vi } from "vitest";
import { HOST_ONLY } from "../../core/auth/host.js";
import type { DialogDeps, DialogRun } from "./native-folder-dialog.js";
import { RepositoriesController } from "./repositories.controller.js";

const PORT = 6473;

interface Who {
	scopes: string[];
	peer: string;
	headers: Record<string, string>;
}

const OWNER_ON_HOST: Who = {
	scopes: [ACCESS_SCOPE],
	peer: "127.0.0.1",
	headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` },
};

const request = (who: Who) => ({
	operator: { device: { id: "d1", scopes: who.scopes } },
	socket: { remoteAddress: who.peer, localPort: PORT },
	headers: who.headers,
});

type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: unknown }) => unknown };
};
const call = (route: unknown, who: Who) =>
	(route as Callable)["~orpc"].handler({
		input: {},
		context: { request: request(who) },
	});

function controller(answer: DialogRun, tool = "zenity") {
	const run = vi.fn(async () => answer);
	const c = new RepositoriesController({} as never, {} as never);
	c.dialogDeps = {
		platform: "linux",
		env: { DISPLAY: ":0" },
		run,
		hasCommand: async (name) => name === tool,
	} satisfies DialogDeps;
	return { routes: c.repositories(), run };
}

const picked: DialogRun = { code: 0, stdout: "/work/app\n", stderr: "" };

describe("RepositoriesController folder dialog (#1216)", () => {
	it("answers the picked folder to the owner on the host", async () => {
		const { routes, run } = controller(picked);
		expect(await call(routes.pickFolder, OWNER_ON_HOST)).toEqual({
			status: "picked",
			path: "/work/app",
		});
		expect(run).toHaveBeenCalledWith("zenity", [
			"--file-selection",
			"--directory",
			"--title=Select a folder",
		]);
	});

	it("answers cancelled, with no path, when the dialog is cancelled", async () => {
		const { routes } = controller({ code: 1, stdout: "", stderr: "" });
		expect(await call(routes.pickFolder, OWNER_ON_HOST)).toEqual({
			status: "cancelled",
		});
	});

	it("answers unavailable, not an error, when the dialog tool is missing", async () => {
		const { routes, run } = controller(picked, "none");
		expect(await call(routes.pickFolder, OWNER_ON_HOST)).toEqual({
			status: "unavailable",
		});
		expect(await call(routes.pickFolderAvailable, OWNER_ON_HOST)).toEqual({
			available: false,
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("refuses with FORBIDDEN a paired device on the host's own browser", async () => {
		const { routes, run } = controller(picked);
		await expect(
			call(routes.pickFolder, { ...OWNER_ON_HOST, scopes: ["operate"] }),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: HOST_ONLY });
		expect(run).not.toHaveBeenCalled();
	});

	it("refuses with FORBIDDEN the owner reaching the API from another computer", async () => {
		const { routes, run } = controller(picked);
		const remote: Who = {
			...OWNER_ON_HOST,
			peer: "192.168.1.20",
			headers: { host: `192.168.1.5:${PORT}`, origin: `http://192.168.1.5:${PORT}` },
		};
		await expect(call(routes.pickFolder, remote)).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: HOST_ONLY,
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("refuses with FORBIDDEN the owner behind a proxy on the host (forwarded) or from another origin", async () => {
		const { routes, run } = controller(picked);
		await expect(
			call(routes.pickFolder, {
				...OWNER_ON_HOST,
				headers: { ...OWNER_ON_HOST.headers, "x-forwarded-for": "100.64.0.9" },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			call(routes.pickFolder, {
				...OWNER_ON_HOST,
				headers: { ...OWNER_ON_HOST.headers, origin: "https://evil.example" },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(run).not.toHaveBeenCalled();
	});

	it("reports the dialog available only to the host owner", async () => {
		const { routes } = controller(picked);
		expect(await call(routes.pickFolderAvailable, OWNER_ON_HOST)).toEqual({
			available: true,
		});
		expect(
			await call(routes.pickFolderAvailable, {
				...OWNER_ON_HOST,
				scopes: ["operate"],
			}),
		).toEqual({ available: false });
		expect(
			await call(routes.pickFolderAvailable, {
				...OWNER_ON_HOST,
				peer: "10.0.0.7",
			}),
		).toEqual({ available: false });
	});
});
