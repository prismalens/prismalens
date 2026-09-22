// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Electron launcher (ADR 0005 §8): a launcher plus a client. It spawns the
 * same backend `pl up` runs as a child, or attaches to one already holding
 * the workspace, opens a window on its loopback URL, and adds presence: a
 * tray, start-at-login, a notification when an investigation finishes. It
 * never embeds the API.
 */

import type { ChildProcess } from "node:child_process";
import { readWorkspaceLockState } from "@prismalens/config";
import {
	app,
	BrowserWindow,
	Menu,
	Notification,
	nativeImage,
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
import {
	backendSpawn,
	backendUrl,
	pickFreePort,
	planLaunch,
} from "./supervisor.js";

const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 15_000;

let child: ChildProcess | null = null;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let baseUrl = "";
let quitting = false;

function workspaceDir(): string {
	// Same default as `pl up`, so the CLI and the app share one workspace.
	return (
		process.env.PRISMALENS_WORKSPACE_DIR ?? `${app.getPath("home")}/.prismalens`
	);
}

async function boot(): Promise<void> {
	const dir = workspaceDir();
	const plan = planLaunch(readWorkspaceLockState(dir), await pickFreePort());
	if (plan.kind === "spawn") {
		const spawnPlan = backendSpawn({
			execPath: process.execPath,
			backendMain: resolveBackendMain({
				resourcesPath: process.resourcesPath,
				env: process.env,
			}),
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
	const ready = await waitForHealth(plan.port, READY_TIMEOUT_MS);
	if (!ready) throw new Error(`Backend not ready at ${baseUrl}`);
}

function openWindow(path = "/"): void {
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
	window.on("closed", () => {
		window = null;
	});
	// Only the backend's own origin renders inside the app; anything else goes
	// to the system browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (!url.startsWith(baseUrl)) shell.openExternal(url);
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
			const res = await fetch(`${baseUrl}/api/investigations?limit=25`);
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
	app.on("before-quit", () => {
		quitting = true;
		if (child) stopBackend(child);
	});
}
