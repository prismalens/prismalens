// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Electron launcher (ADR 0005 §8): a launcher plus a client. It spawns the
 * same backend `pl up` runs as a child, or attaches to one already holding
 * the workspace, opens a window on its loopback URL, and adds presence: a
 * tray, start-at-login, a notification when an investigation finishes. It
 * never embeds the API.
 */

import { type ChildProcess, execFile, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deviceCookieName } from "@prismalens/auth/device-cookie";
import {
	ensureInstanceFile,
	installedService,
	readWorkspaceLockState,
	serviceManagerKind,
	serviceOwnsWorkspace,
} from "@prismalens/config";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	Notification,
	nativeImage,
	nativeTheme,
	session,
	shell,
	Tray,
} from "electron";
import contextMenu from "electron-context-menu";
import windowStateKeeper from "electron-window-state";
import {
	resolveBackendMain,
	startBackend,
	stopBackend,
	waitForHealth,
} from "./backend.js";
import {
	backgroundColor,
	frameOptions,
	isTheme,
	THEME_CHANNEL,
	THEME_COOKIE,
	type Theme,
	themeFromCookie,
	titleBarOverlay,
} from "./chrome.js";
import { readLoginShellPath } from "./login-shell-path.js";
import { appMenuTemplate } from "./menu.js";
import {
	askNotificationText,
	askSnapshot,
	type InvestigationSummary,
	newlyAsking,
	newlyFinished,
	notificationText,
	runningCount,
	runningLabel,
	snapshot,
} from "./notifications.js";
import {
	fetchInstanceId,
	OlderBackendError,
	operatorToken,
	storedCandidates,
} from "./session.js";
import {
	appendTail,
	type BackendSpawn,
	backendSpawn,
	backendUrl,
	nextFreePort,
	OLDER_BACKEND_DIALOG,
	pairOperatorSpawn,
	planLaunch,
	portFree,
	portTakenDialog,
	refusalIcon,
	resetWorkspaceSpawn,
	type StopDialog,
	serviceStartCommands,
	stopDialog,
	type Target,
} from "./supervisor.js";
import {
	availableUpdate,
	backendVersion,
	latestReleaseUrl,
	releaseUrl,
	updateCheckEnabled,
} from "./updates.js";
import {
	missingPlChoice,
	type NothingRunningChoice,
	nothingRunningChoice,
	parseDefaultDistro,
	parseDistros,
	parseProbe,
	parseWslSettings,
	planWslLaunch,
	portTakenByWslDialog,
	type WslRun,
	type WslSettings,
	wslActive,
	wslMenuItems,
	wslMissingPl,
	wslNothingRunning,
	wslPairOperator,
	wslProbe,
} from "./wsl.js";

const READY_TIMEOUT_MS = 60_000;
/** `pnpm dev:desktop`: window on the running Vite dev server instead of a packed backend. */
const DEV_URL = process.env.PRISMALENS_DESKTOP_DEV_URL;
const POLL_MS = 15_000;
/** Every dialog's title; the default is the package name, `@prismalens/desktop` (#673 w50). */
const TITLE = "PrismaLens";
/** A port chosen for this run because the workspace's own was taken; never saved. */
let portOverride: number | null = null;

let child: ChildProcess | null = null;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let baseUrl = "";
/** The window's device token, also the Bearer the notification poll sends. */
let deviceToken = "";
let ready = false;
let quitting = false;
let stopping = false;
/** This launcher spawned the backend, rather than attaching to a `pl up`. */
let owned = false;
let backendMainPath = "";
/** The last stderr lines of the owned backend, for the dialog when it stops. */
let stderrTail: string[] = [];
/** A stop dialog is up; the poll must not stack a second one. */
let stopShown = false;
let running = 0;
/** A newer release with its downloads attached, once the check has found one. */
let update: string | null = null;
/** The app's theme, read from its cookie at boot and pushed by the page after. */
let theme: Theme = "dark";
/** Rebuilds the tray menu; set once the tray exists. */
let refreshTray: () => void = () => {};

function wslSettingsPath(): string {
	return join(app.getPath("userData"), "wsl.json");
}

function readWslSettings(): WslSettings {
	try {
		return parseWslSettings(readFileSync(wslSettingsPath(), "utf8"));
	} catch {
		return parseWslSettings(null);
	}
}

/** A switch takes effect on relaunch: one backend per app, never two at once. */
function saveWslSettings(next: WslSettings): void {
	mkdirSync(app.getPath("userData"), { recursive: true });
	writeFileSync(wslSettingsPath(), JSON.stringify(next));
	app.relaunch();
	app.quit();
}

let wsl: WslSettings = { enabled: false, distro: null };
/** Set once at boot: the window attaches to a `pl` inside WSL, not to this app's packed copy. */
let inWsl = false;
let distros: string[] = [];
let defaultDistro: string | null = null;

function workspaceDir(): string {
	// Same default as `pl up`, so the CLI and the app share one workspace.
	return (
		process.env.PRISMALENS_WORKSPACE_DIR ??
		path.join(app.getPath("home"), ".prismalens")
	);
}

class LaunchRefused extends Error {
	constructor(readonly dialog: StopDialog) {
		super(dialog.message);
	}
}

/** The owned backend exited while starting; its own stop dialog has the say. */
class BackendExited extends Error {}

/** The user chose to leave from a boot dialog; the quit or relaunch is already on its way. */
class Leaving extends Error {}

/** Settles when the owned backend exits; `connect` races its health wait against it. */
let exited: Promise<void> = new Promise(() => {});
let booted = false;

function protocol(): "http" | "https" {
	return process.env.PRISMALENS_PROTOCOL === "https" ? "https" : "http";
}

async function boot(): Promise<void> {
	if (DEV_URL) {
		owned = false;
		return connectTo(DEV_URL);
	}
	wsl = readWslSettings();
	inWsl = wslActive(process.platform, wsl);
	if (inWsl) return bootWsl();
	const dir = workspaceDir();
	backendMainPath = resolveBackendMain({
		resourcesPath: process.resourcesPath,
		env: process.env,
	});
	const service = installedService();
	const plan = planLaunch({
		lock: readWorkspaceLockState(dir),
		service,
		ownsWorkspace: serviceOwnsWorkspace(dir, service),
		storedPort: ensureInstanceFile(dir).port,
		protocol: protocol(),
	});
	owned = plan.kind === "spawn";
	if (plan.kind === "spawn") await spawnOwned(plan.target);
	if (plan.kind === "service" && service) startService(service.unitPath);
	await connect(plan.target);
}

/** Spawn `pl up` on the workspace's own port, refusing one something else holds. */
async function spawnOwned(target: Target): Promise<void> {
	if (!(await portFree(target.port))) {
		const holderInstanceId = await portHolder(target);
		const freePort = await nextFreePort(target.port);
		if (holderInstanceId && (await heldByWsl(holderInstanceId))) {
			throw new LaunchRefused({
				kind: "port-taken-wsl",
				...portTakenByWslDialog({
					port: target.port,
					distro: wsl.distro,
					freePort,
				}),
			});
		}
		throw new LaunchRefused(
			portTakenDialog({
				port: target.port,
				byPrismaLens: holderInstanceId !== null,
				freePort,
				instanceFile: join(workspaceDir(), "instance.json"),
			}),
		);
	}
	adopt(
		startBackend(
			backendSpawn({
				execPath: process.execPath,
				backendMain: backendMainPath,
				port: target.port,
				workspaceDir: workspaceDir(),
				env: process.env,
				loginShellPath: await readLoginShellPath(),
			}),
		),
	);
}

/** Whether the port's holder is the chosen distro's PrismaLens; any probe failure says no. */
async function heldByWsl(holderInstanceId: string): Promise<boolean> {
	if (process.platform !== "win32" || inWsl) return false;
	try {
		// Mirrored networking puts the WSL pl on 127.0.0.1:6473 too (#673 w50).
		const probe = parseProbe(await runWsl(wslProbe(wsl.distro)));
		return probe.instanceId === holderInstanceId;
	} catch {
		return false;
	}
}

/** Track an owned backend: its stderr tail, and a stop dialog when it exits. */
function adopt(backend: ChildProcess): void {
	stderrTail = [];
	child = backend;
	owned = true;
	exited = new Promise((resolve) => backend.once("exit", () => resolve()));
	backend.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(chunk);
		stderrTail = appendTail(stderrTail, chunk.toString("utf8"));
	});
	backend.once("exit", (code) => {
		if (child === backend) child = null;
		if (!quitting) void showStop({ owned: true, code, stderrTail });
	});
}

/**
 * Attach to the `pl` running in the chosen distro (#767, walk u20). Nothing
 * running there is a dialog, never a spawn: the app starts nothing in WSL.
 */
async function bootWsl(): Promise<void> {
	const probe = parseProbe(await runWsl(wslProbe(wsl.distro)));
	if (!probe.hasPl) {
		const defaultName = wsl.distro ? null : (await listDistros()).defaultName;
		const d = wslMissingPl(wsl.distro, defaultName);
		const { response } = await dialog.showMessageBox({
			title: TITLE,
			type: "error",
			message: d.message,
			detail: d.detail,
			buttons: d.buttons,
			defaultId: 0,
			cancelId: d.buttons.length - 1,
		});
		return leaveOrRetry(missingPlChoice(wsl, response));
	}
	const plan = planWslLaunch(probe);
	if (plan.kind === "none") {
		const d = wslNothingRunning(wsl.distro);
		const { response } = await dialog.showMessageBox({
			title: TITLE,
			type: "warning",
			message: d.message,
			detail: d.detail,
			buttons: d.buttons,
			defaultId: 0,
			cancelId: d.buttons.length - 1,
		});
		return leaveOrRetry(nothingRunningChoice(wsl, response));
	}
	owned = false;
	await connect(plan.target);
}

async function leaveOrRetry(choice: NothingRunningChoice): Promise<void> {
	if (choice.kind === "retry") return bootWsl();
	if (choice.kind === "relaunch") saveWslSettings(choice.settings);
	else app.quit();
	throw new Leaving();
}

/** Run a short script in the distro and return its stdout. */
function runWsl(plan: WslRun): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = execFile(
			plan.command,
			plan.args,
			{ env: plan.env, windowsHide: true, timeout: 60_000 },
			(error, stdout, stderr) =>
				error
					? reject(new Error(`${error.message}\n${stderr}`.trim()))
					: resolve(stdout),
		);
		proc.stdin?.on("error", () => {});
		proc.stdin?.end(plan.script);
	});
}

function wslList(args: string[]): Promise<Buffer | null> {
	return new Promise((resolve) => {
		execFile(
			"wsl.exe",
			args,
			{ encoding: "buffer", windowsHide: true, timeout: 10_000 },
			(error, stdout) => resolve(error ? null : stdout),
		);
	});
}

/** Every distro, and the one `wsl.exe` marks as its default. */
async function listDistros(): Promise<{
	names: string[];
	defaultName: string | null;
}> {
	const [quiet, verbose] = await Promise.all([
		wslList(["-l", "-q"]),
		wslList(["-l", "-v"]),
	]);
	return {
		names: quiet ? parseDistros(quiet) : [],
		defaultName: verbose ? parseDefaultDistro(verbose) : null,
	};
}

async function portHolder(target: Target): Promise<string | null> {
	try {
		return await fetchInstanceId(backendUrl(target));
	} catch {
		return null;
	}
}

/** Start, never enable, the unit `pl service install` wrote (#763). */
function startService(unitPath: string): void {
	const kind = serviceManagerKind();
	if (!kind) return;
	for (const step of serviceStartCommands(
		kind,
		unitPath,
		process.getuid?.() ?? 0,
	)) {
		const result = spawnSync(step.argv[0] as string, step.argv.slice(1), {
			encoding: "utf8",
		});
		if (result.status !== 0 && !step.optional) {
			throw new Error(
				`\`${step.argv.join(" ")}\` failed: ${result.stderr || result.error?.message || result.status}`,
			);
		}
	}
}

async function connect(target: Target): Promise<void> {
	return connectTo(backendUrl(target));
}

async function connectTo(url: string): Promise<void> {
	baseUrl = url;
	const healthy = await Promise.race([
		waitForHealth(baseUrl, READY_TIMEOUT_MS),
		owned ? exited.then(() => null) : new Promise<never>(() => {}),
	]);
	if (healthy === null) throw new BackendExited();
	if (!healthy) throw new Error(`Backend not ready at ${baseUrl}`);
	await pairWindow(workspaceDir());
	const [themeCookie] = await session.defaultSession.cookies.get({
		url: baseUrl,
		name: THEME_COOKIE,
	});
	applyTheme(themeFromCookie(themeCookie?.value));
	ready = true;
}

/** The instance id each base URL answered with last, kept beside the cookie jar. */
function identityPath(): string {
	return join(app.getPath("userData"), "instances.json");
}

function readIdentities(): Record<string, string> {
	try {
		return JSON.parse(readFileSync(identityPath(), "utf8")) as Record<
			string,
			string
		>;
	} catch {
		return {};
	}
}

function writeIdentity(url: string, instanceId: string): void {
	mkdirSync(app.getPath("userData"), { recursive: true });
	writeFileSync(
		identityPath(),
		JSON.stringify({ ...readIdentities(), [url]: instanceId }),
		{ mode: 0o600 },
	);
}

/** The window pairs like any browser (ADR 0004 §8); see `session.ts`. */
async function pairWindow(dir: string): Promise<void> {
	const jar = session.defaultSession.cookies;
	const instanceId = await fetchInstanceId(baseUrl);
	const cookieName = deviceCookieName(instanceId);
	const [stored] = await jar.get({ url: baseUrl, name: cookieName });
	deviceToken = await operatorToken({
		baseUrl,
		cookieName,
		candidates: storedCandidates({
			instanceId,
			expectedId: readIdentities()[baseUrl] ?? null,
			stored: stored?.value ?? null,
		}),
		pairOperator: () =>
			inWsl
				? runWsl(wslPairOperator(wsl.distro))
				: DEV_URL
					? runForStdout({
							command: "pnpm",
							args: [
								"--silent",
								"--filter",
								"prismalens",
								"dev",
								"pair",
								"--operator",
							],
							env: process.env,
						})
					: runForStdout(
							pairOperatorSpawn({
								execPath: process.execPath,
								backendMain: backendMainPath,
								workspaceDir: dir,
								env: process.env,
							}),
						),
	});
	if (deviceToken !== stored?.value) {
		await jar.set({
			url: baseUrl,
			name: cookieName,
			value: deviceToken,
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			// Validity is revocation, not expiry: the server's own cookie is a year.
			expirationDate: Date.now() / 1000 + 365 * 24 * 60 * 60,
		});
	}
	writeIdentity(baseUrl, instanceId);
}

/** No silent quits: say why the backend stopped and offer the way on. */
async function showStop(input: {
	owned: boolean;
	code: number | null;
	stderrTail: string[];
}): Promise<void> {
	if (stopShown) return;
	stopShown = true;
	ready = false;
	const d = stopDialog(input);
	const { response } = await dialog.showMessageBox({
		title: TITLE,
		type: d.kind === "attached-gone" ? "warning" : "error",
		message: d.message,
		detail: d.detail,
		buttons: d.buttons,
		defaultId: 0,
		cancelId: d.buttons.length - 1,
	});
	stopShown = false;
	if (response !== 0) {
		app.quit();
		return;
	}
	if (d.kind === "newer-database") {
		const found = update ?? (await newerRelease());
		await shell.openExternal(found ? releaseUrl(found) : latestReleaseUrl());
		app.quit();
		return;
	}
	try {
		if (inWsl) {
			await bootWsl();
			if (!booted) {
				afterBoot();
				return;
			}
			refreshTray();
			if (window) window.loadURL(baseUrl);
			else openWindow();
			return;
		}
		if (DEV_URL) {
			await connectTo(DEV_URL);
		} else {
			const target: Target = {
				protocol: protocol(),
				host: "127.0.0.1",
				port: portOverride ?? ensureInstanceFile(workspaceDir()).port,
			};
			await spawnOwned(target);
			await connect(target);
		}
		if (!booted) {
			afterBoot();
			return;
		}
		refreshTray();
		if (window) window.loadURL(baseUrl);
		else openWindow();
	} catch (error) {
		await refuse(error);
	}
}

async function newerRelease(): Promise<string | null> {
	const current = backendVersion(backendMainPath);
	return current ? availableUpdate(current) : null;
}

/** A launch that cannot go on: its dialog, then quit. */
async function refuse(error: unknown): Promise<void> {
	if (error instanceof BackendExited || error instanceof Leaving) return;
	const d =
		error instanceof LaunchRefused
			? error.dialog
			: error instanceof OlderBackendError
				? OLDER_BACKEND_DIALOG
				: null;
	if (d) {
		const { response } = await dialog.showMessageBox({
			title: TITLE,
			type: refusalIcon(d),
			message: d.message,
			detail: d.detail,
			buttons: d.buttons,
			cancelId: d.buttons.length - 1,
		});
		if (d.kind === "port-taken-wsl" && response === 0) {
			saveWslSettings({ ...wsl, enabled: true });
			return;
		}
		// "Start on port N" is the button just before Quit (#673 w50).
		if (d.freePort && response === d.buttons.length - 2) {
			return startOnPort(d.freePort);
		}
	} else {
		dialog.showErrorBox("PrismaLens could not start", String(error));
	}
	app.quit();
}

/** Run this workspace's own backend on `port` for this launch only. */
async function startOnPort(port: number): Promise<void> {
	portOverride = port;
	const target: Target = { protocol: protocol(), host: "127.0.0.1", port };
	try {
		await spawnOwned(target);
		await connect(target);
		if (!booted) {
			afterBoot();
			return;
		}
		refreshTray();
		if (window) window.loadURL(baseUrl);
		else openWindow();
	} catch (error) {
		await refuse(error);
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
	const state = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 840 });
	window = new BrowserWindow({
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
		// Below this the sidebar folds to the phone top bar; a desktop window
		// never needs to go there.
		minWidth: 800,
		minHeight: 560,
		title: "PrismaLens",
		// macOS takes the app bundle's icon; Linux and Windows need it here.
		...(process.platform === "darwin" ? {} : { icon: asset("icon.png") }),
		show: false,
		...frameOptions(process.platform, theme),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
		},
	});
	state.manage(window);
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
		// The current base, read per call: a restart or reattach can move it.
		const external =
			target.origin !== new URL(baseUrl).origin &&
			(target.protocol === "http:" || target.protocol === "https:");
		if (external) void shell.openExternal(target.href);
		return { action: "deny" };
	});
	window.loadURL(`${baseUrl}${path}`);
}

/** Native surfaces follow the in-app theme: dialogs, menus, the frame. */
function applyTheme(next: Theme): void {
	theme = next;
	nativeTheme.themeSource = next;
	if (!window) return;
	window.setBackgroundColor(backgroundColor(next));
	if (process.platform !== "darwin")
		window.setTitleBarOverlay(titleBarOverlay(next));
}

/** Windows only: the WSL switch and its distro picker (#767). */
function wslTrayItems(): MenuItemConstructorOptions[] {
	if (process.platform !== "win32") return [];
	const items = wslMenuItems(wsl, distros, defaultDistro);
	return [
		{ type: "separator" },
		{
			label: items.toggle.label,
			type: "checkbox",
			checked: items.toggle.checked,
			click: () => saveWslSettings({ ...wsl, enabled: !wsl.enabled }),
		},
		{
			label: "WSL distro",
			submenu: items.distros.map((item) => ({
				label: item.label,
				type: "radio",
				checked: item.checked,
				click: () => {
					if (item.distro === wsl.distro) return;
					const next = { ...wsl, distro: item.distro ?? null };
					if (wsl.enabled) saveWslSettings(next);
					else {
						writeFileSync(wslSettingsPath(), JSON.stringify(next));
						wsl = next;
						refreshTray();
					}
				},
			})),
		},
	];
}

function buildTray(): void {
	tray = new Tray(trayIcon());
	tray.setToolTip("PrismaLens");
	const refresh = () => {
		const login = app.getLoginItemSettings().openAtLogin;
		const label = runningLabel(running);
		tray?.setToolTip(`PrismaLens: ${label.toLowerCase()}`);
		// macOS shows a title beside the icon; elsewhere the menu line carries it.
		if (process.platform === "darwin")
			tray?.setTitle(running ? String(running) : "");
		tray?.setContextMenu(
			Menu.buildFromTemplate([
				{ label, enabled: false },
				...(update
					? [
							{
								label: `Download PrismaLens ${update}…`,
								click: () =>
									void shell.openExternal(releaseUrl(update as string)),
							},
						]
					: []),
				{ type: "separator" },
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
				...wslTrayItems(),
				{ type: "separator" },
				{
					label: owned
						? "Reset workspace…"
						: "Reset workspace… (stop `pl up` first)",
					enabled: owned && !inWsl,
					click: () => void confirmReset(),
				},
				{ label: "Quit", click: () => app.quit() },
			]),
		);
	};
	refreshTray = refresh;
	refresh();
	if (process.platform === "win32") {
		void listDistros().then((found) => {
			distros = found.names;
			defaultDistro = found.defaultName;
			refresh();
		});
	}
	tray.on("click", () => openWindow());
}

/**
 * Delete the workspace (`pl reset`) and start again from setup. Only when this
 * launcher owns the backend: a `pl up` in a terminal holds the workspace, and
 * the reset must not pull it from under that process.
 */
async function confirmReset(): Promise<void> {
	const dir = workspaceDir();
	const { response } = await dialog.showMessageBox({
		title: TITLE,
		type: "warning",
		buttons: ["Cancel", "Delete and restart"],
		defaultId: 0,
		cancelId: 0,
		message: "Reset the workspace?",
		detail: `This deletes ${dir}: every incident, investigation, integration, paired device and secret. It cannot be undone.`,
	});
	if (response !== 1) return;
	quitting = true;
	const backend = child;
	if (backend && backend.exitCode === null && backend.signalCode === null) {
		await new Promise<void>((resolve) => {
			backend.once("exit", () => resolve());
			stopBackend(backend);
		});
	}
	try {
		await runForStdout(
			resetWorkspaceSpawn({
				execPath: process.execPath,
				backendMain: backendMainPath,
				workspaceDir: dir,
				env: process.env,
			}),
		);
	} catch (error) {
		dialog.showErrorBox("Reset failed", String(error));
	}
	app.relaunch();
	app.exit(0);
}

// `assets/` ships inside the app (build.files); electron-builder's `build/` does not (#745).
function asset(name: string): string {
	return fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
}

function trayIcon() {
	// macOS tints the one-colour template mark to the menu bar; elsewhere the
	// coloured tile. Each loads its @2x sibling on HiDPI screens.
	const mac = process.platform === "darwin";
	const image = nativeImage.createFromPath(
		asset(mac ? "trayTemplate.png" : "tray.png"),
	);
	if (mac) image.setTemplateImage(true);
	return image;
}

function startPolling(): void {
	let previous = new Map<string, InvestigationSummary["status"]>();
	let asking = new Map<string, string>();
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
				for (const ask of newlyAsking(asking, current)) {
					const n = new Notification(askNotificationText(ask));
					n.on("click", () =>
						openWindow(
							ask.incidentId
								? `/incidents/${ask.incidentId}/conversation?investigation=${ask.id}`
								: "/",
						),
					);
					n.show();
				}
			}
			previous = snapshot(current);
			asking = askSnapshot(current);
			first = false;
			const count = runningCount(current);
			if (count !== running) {
				running = count;
				refreshTray();
			}
		} catch {
			// A missed poll is retried; an attached backend that is gone is said so.
			if (ready && !owned && !(await waitForHealth(baseUrl, 3_000))) {
				void showStop({ owned: false, code: null, stderrTail: [] });
			}
		}
	};
	setInterval(tick, POLL_MS);
	void tick();
}

const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

/** The macOS menu's "Check for Updates…": always answers, unlike the daily check. */
async function checkForUpdatesNow(): Promise<void> {
	const current = backendVersion(backendMainPath);
	const found = current ? await availableUpdate(current) : null;
	if (found) {
		void shell.openExternal(releaseUrl(found));
		return;
	}
	await dialog.showMessageBox({
		title: TITLE,
		message: current
			? "PrismaLens is up to date"
			: "Could not read this build's version",
		detail: current ? `You have ${current}.` : undefined,
	});
}

/** Daily: a notification once per new version, and a tray item to download it. */
function startUpdateChecks(): void {
	if (DEV_URL) return;
	const current = backendVersion(backendMainPath);
	if (!current || !updateCheckEnabled(process.env)) return;
	const check = async () => {
		const found = await availableUpdate(current);
		if (!found || found === update) return;
		update = found;
		refreshTray();
		if (Notification.isSupported()) {
			const n = new Notification({
				title: `PrismaLens ${found} is available`,
				body: `You have ${current}. Click to download the new version.`,
			});
			n.on("click", () => void shell.openExternal(releaseUrl(found)));
			n.show();
		}
	};
	setInterval(() => void check(), UPDATE_EVERY_MS);
	void check();
}

function afterBoot(): void {
	booted = true;
	buildTray();
	openWindow();
	startPolling();
	startUpdateChecks();
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => openWindow());
	ipcMain.on(THEME_CHANNEL, (event, value: unknown) => {
		if (event.sender !== window?.webContents || !isTheme(value)) return;
		applyTheme(value);
	});
	app
		.whenReady()
		.then(async () => {
			// Taskbar grouping and notifications key on this; it matches the build's appId.
			if (process.platform === "win32")
				app.setAppUserModelId("io.prismalens.desktop");
			Menu.setApplicationMenu(
				((template) => (template ? Menu.buildFromTemplate(template) : null))(
					appMenuTemplate(process.platform, TITLE, {
						openSettings: () => openWindow("/settings"),
						checkForUpdates: () => void checkForUpdatesNow(),
					}),
				),
			);
			// Cut, copy and paste where there is text to act on; nothing elsewhere.
			contextMenu({
				shouldShowMenu: (_event, params) =>
					params.isEditable || params.selectionText.trim() !== "",
				showSearchWithGoogle: false,
				showLookUpSelection: false,
				showInspectElement: !app.isPackaged,
			});
			await boot();
			afterBoot();
		})
		.catch((error) => {
			console.error(error);
			void refuse(error);
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
