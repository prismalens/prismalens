// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Electron launcher (ADR 0005 §8): a launcher plus a client. It spawns the
 * same backend `pl up` runs as a child, or attaches to one already holding
 * the workspace, opens a window on its loopback URL, and adds presence: a
 * tray, start-at-login, a notification when an investigation finishes. It
 * never embeds the API.
 */

import { type ChildProcess, execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readWorkspaceLockState } from "@prismalens/config";
import {
	app,
	BrowserWindow,
	Menu,
	Notification,
	nativeImage,
	session,
	shell,
	Tray,
} from "electron";
import {
	resolveBackendMain,
	startBackend,
	stopBackend,
	waitForHealth,
} from "./backend.js";
import { readLoginShellPath } from "./login-shell-path.js";
import {
	type InvestigationSummary,
	newlyFinished,
	notificationText,
	snapshot,
} from "./notifications.js";
import { DEVICE_COOKIE, operatorToken } from "./session.js";
import {
	type BackendSpawn,
	backendSpawn,
	backendUrl,
	pairOperatorSpawn,
	pickFreePort,
	planLaunch,
} from "./supervisor.js";

const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 15_000;

let child: ChildProcess | null = null;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let baseUrl = "";
/** The window's device token, also the Bearer the notification poll sends. */
let deviceToken = "";
let ready = false;
let quitting = false;
let stopping = false;

function workspaceDir(): string {
	// Same default as `pl up`, so the CLI and the app share one workspace.
	return (
		process.env.PRISMALENS_WORKSPACE_DIR ?? `${app.getPath("home")}/.prismalens`
	);
}

async function boot(): Promise<void> {
	const dir = workspaceDir();
	const plan = planLaunch(readWorkspaceLockState(dir), await pickFreePort());
	const backendMain = resolveBackendMain({
		resourcesPath: process.resourcesPath,
		env: process.env,
	});
	if (plan.kind === "spawn") {
		const spawnPlan = backendSpawn({
			execPath: process.execPath,
			backendMain,
			port: plan.port,
			workspaceDir: dir,
			env: process.env,
			loginShellPath: await readLoginShellPath(),
		});
		child = startBackend(spawnPlan);
		child.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(chunk);
		});
		child.once("exit", (code) => {
			if (!quitting) {
				console.error(`prismalens backend exited with ${code}`);
				app.quit();
			}
		});
	}
	baseUrl = backendUrl(plan.port);
	if (!(await waitForHealth(plan.port, READY_TIMEOUT_MS))) {
		throw new Error(`Backend not ready at ${baseUrl}`);
	}
	await pairWindow(backendMain, dir);
	ready = true;
}

/** The window pairs like any browser (ADR 0004 §8); see `session.ts`. */
async function pairWindow(backendMain: string, dir: string): Promise<void> {
	const jar = session.defaultSession.cookies;
	const [stored] = await jar.get({ url: baseUrl, name: DEVICE_COOKIE });
	deviceToken = await operatorToken({
		baseUrl,
		storedToken: stored?.value ?? null,
		pairOperator: () =>
			runForStdout(
				pairOperatorSpawn({
					execPath: process.execPath,
					backendMain,
					workspaceDir: dir,
					env: process.env,
				}),
			),
	});
	if (deviceToken !== stored?.value) {
		await jar.set({
			url: baseUrl,
			name: DEVICE_COOKIE,
			value: deviceToken,
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			// Validity is revocation, not expiry: the server's own cookie is a year.
			expirationDate: Date.now() / 1000 + 365 * 24 * 60 * 60,
		});
	}
}

function runForStdout(plan: BackendSpawn): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			plan.command,
			plan.args,
			{ env: plan.env, windowsHide: true, timeout: 30_000 },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
}

function openWindow(path = "/"): void {
	// `second-instance` and `activate` can fire while the backend is booting.
	if (!ready) return;
	if (window) {
		window.show();
		window.focus();
		if (path !== "/") window.loadURL(`${baseUrl}${path}`);
		return;
	}
	window = new BrowserWindow({
		width: 1280,
		height: 840,
		title: "PrismaLens",
		show: false,
		webPreferences: { contextIsolation: true, nodeIntegration: false },
	});
	window.once("ready-to-show", () => window?.show());
	// PRISMALENS_DESKTOP_SMOKE=<png path>: prove the window rendered the app,
	// write the capture, quit. What CI runs under xvfb, and what a box with no
	// display server to look at runs by hand.
	const smoke = process.env.PRISMALENS_DESKTOP_SMOKE;
	if (smoke) {
		window.webContents.once("did-finish-load", async () => {
			await new Promise((r) => setTimeout(r, 4_000));
			const image = await window?.webContents.capturePage();
			if (image) writeFileSync(smoke, image.toPNG());
			app.quit();
		});
	}
	window.on("closed", () => {
		window = null;
	});
	// Only the backend's own origin renders inside the app; anything else goes
	// to the system browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		// Compare origins, not prefixes: `http://127.0.0.1:3001.evil` starts
		// with the base URL.
		let target: URL;
		try {
			target = new URL(url);
		} catch {
			return { action: "deny" };
		}
		const external =
			target.origin !== new URL(baseUrl).origin &&
			(target.protocol === "http:" || target.protocol === "https:");
		if (external) void shell.openExternal(target.href);
		return { action: "deny" };
	});
	window.loadURL(`${baseUrl}${path}`);
}

function buildTray(): void {
	tray = new Tray(trayIcon());
	tray.setToolTip("PrismaLens");
	const refresh = () => {
		const login = app.getLoginItemSettings().openAtLogin;
		tray?.setContextMenu(
			Menu.buildFromTemplate([
				{ label: "Open PrismaLens", click: () => openWindow() },
				{
					label: "Pair a device",
					click: () => openWindow("/settings?tab=devices"),
				},
				{ type: "separator" },
				{
					label: "Start at login",
					type: "checkbox",
					checked: login,
					click: () => {
						app.setLoginItemSettings({ openAtLogin: !login });
						refresh();
					},
				},
				{ type: "separator" },
				{ label: "Quit", click: () => app.quit() },
			]),
		);
	};
	refresh();
	tray.on("click", () => openWindow());
}

function trayIcon() {
	// A 16x16 template mark drawn in code keeps the package free of binary
	// assets; a designed icon lands with the signed build (#697).
	const size = 16;
	const buf = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			const inRing =
				Math.hypot(x - 7.5, y - 7.5) <= 7 && Math.hypot(x - 7.5, y - 7.5) >= 4;
			buf[i] = 0;
			buf[i + 1] = 0;
			buf[i + 2] = 0;
			buf[i + 3] = inRing ? 255 : 0;
		}
	}
	const image = nativeImage.createFromBitmap(buf, {
		width: size,
		height: size,
	});
	image.setTemplateImage(true);
	return image;
}

function startPolling(): void {
	let previous = new Map<string, InvestigationSummary["status"]>();
	let first = true;
	const tick = async () => {
		try {
			const res = await fetch(`${baseUrl}/api/investigations?limit=25`, {
				headers: { authorization: `Bearer ${deviceToken}` },
			});
			if (!res.ok) return;
			const body = (await res.json()) as { data: InvestigationSummary[] };
			const current = body.data;
			if (!first && Notification.isSupported()) {
				for (const inv of newlyFinished(previous, current)) {
					const text = notificationText(inv);
					const n = new Notification(text);
					n.on("click", () =>
						openWindow(inv.incidentId ? `/incidents/${inv.incidentId}` : "/"),
					);
					n.show();
				}
			}
			previous = snapshot(current);
			first = false;
		} catch {
			// The backend is the source of truth; a missed poll is retried next tick.
		}
	};
	setInterval(tick, POLL_MS);
	void tick();
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => openWindow());
	app
		.whenReady()
		.then(async () => {
			await boot();
			buildTray();
			openWindow();
			startPolling();
		})
		.catch((error) => {
			console.error(error);
			app.quit();
		});
	app.on("window-all-closed", () => {
		// Presence: closing the window leaves the tray and the backend running.
	});
	app.on("activate", () => openWindow());
	app.on("before-quit", (event) => {
		quitting = true;
		const running = child;
		if (!running || running.exitCode !== null || running.signalCode !== null) {
			return;
		}
		// Hold the quit until the backend has exited, so it is never orphaned.
		event.preventDefault();
		if (stopping) return;
		stopping = true;
		running.once("exit", () => app.quit());
		stopBackend(running);
	});
}
