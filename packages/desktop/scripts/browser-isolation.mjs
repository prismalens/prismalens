// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The run panel's browser is isolated from the app (#973), proven in a real
 * Electron: the app's cookie never reaches a page in the view, the view has
 * no Node and no bridge, it refuses file: and javascript:, and the app window
 * refuses to leave its origin. Run with `pnpm test:browser` (builds first).
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { app, BrowserWindow, session } from "electron";
import { attachBrowser, guardAppWindow } from "../dist/browser-pane.js";

// A GUI Electron on Windows has no console to print to; the report goes to a file.
const report =
	process.env.PL_BROWSER_REPORT ??
	new URL("../dist/browser-isolation.txt", import.meta.url);
writeFileSync(report, "");
const log = (line) =>
	appendFileSync(
		report,
		`${line}
`,
	);
setTimeout(() => {
	log("FAIL timed out");
	app.exit(2);
}, 60_000).unref();
// Top-level await in an ESM main holds back `ready`; the test runs once the app is up.
app
	.whenReady()
	.then(main)
	.catch((e) => {
		log(`FAIL ${e?.stack ?? e}`);
		app.exit(1);
	});

async function main() {
	const seen = [];
	const server = createServer((req, res) => {
		seen.push({ url: req.url, cookie: req.headers.cookie ?? null });
		if (req.url === "/to-tel") {
			res.writeHead(302, { location: "tel:123" });
			res.end();
			return;
		}
		res.setHeader("content-type", "text/html");
		res.end(`<!doctype html><title>${req.url}</title><p>${req.url}</p>`);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const other = createServer((_req, res) => res.end("other"));
	await new Promise((r) => other.listen(0, "127.0.0.1", r));
	const foreign = `http://127.0.0.1:${other.address().port}`;

	const results = {};
	const check = (name, ok, detail) => {
		results[name] = ok ? "pass" : `FAIL ${JSON.stringify(detail)}`;
		log(
			`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
		);
	};
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));

	log("ready");
	await session.defaultSession.cookies.set({
		url: base,
		name: "prismalens_device",
		value: "app-secret",
	});
	const win = new BrowserWindow({
		show: false,
		width: 1200,
		height: 800,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: new URL("../dist/preload.cjs", import.meta.url).pathname.replace(
				/^\/([A-Za-z]:)/,
				"$1",
			),
		},
	});
	guardAppWindow(win, () => base);
	attachBrowser(win, () => base, true);
	await win.loadURL(`${base}/app`);

	// The app drives the view through its bridge, as the panel does.
	await win.webContents.executeJavaScript(
		`window.prismalensDesktop.browser.open(${JSON.stringify(`${base}/page`)}); window.prismalensDesktop.browser.setBounds({x:0,y:0,width:600,height:400});`,
	);
	await wait(1500);
	const view = win.contentView.children.find((c) => c.webContents);
	check(
		"the view exists and loaded the page",
		!!view && view.webContents.getURL() === `${base}/page`,
		view?.webContents.getURL(),
	);

	const page = seen.find((s) => s.url === "/page");
	check(
		"the app's cookie was not sent to the page",
		page && page.cookie === null,
		page,
	);
	const appLoad = seen.find((s) => s.url === "/app");
	check(
		"the app's own load did carry its cookie (the test can see one)",
		appLoad?.cookie?.includes("app-secret"),
		appLoad,
	);

	const inside = await view.webContents.executeJavaScript(
		`({ require: typeof require, process: typeof process, bridge: typeof window.prismalensDesktop, cookie: document.cookie })`,
	);
	check(
		"no Node, no bridge, no app cookie inside the view",
		inside.require === "undefined" &&
			inside.process === "undefined" &&
			inside.bridge === "undefined" &&
			inside.cookie === "",
		inside,
	);

	const before = view.webContents.getURL();
	await view.webContents
		.executeJavaScript(`location.href = "file:///etc/hosts"`)
		.catch(() => {});
	await wait(500);
	check(
		"a page cannot navigate the view to file:",
		view.webContents.getURL() === before,
		view.webContents.getURL(),
	);

	const states = [];
	win.webContents.ipc?.on?.("noop", () => {});
	await win.webContents.executeJavaScript(
		`window.__s=[]; window.prismalensDesktop.browser.onState(s=>window.__s.push(s)); window.prismalensDesktop.browser.open("javascript:alert(1)");`,
	);
	await wait(300);
	const refused = await win.webContents.executeJavaScript("window.__s.at(-1)");
	states.push(refused);
	check(
		"the bridge refuses javascript: and says so",
		refused?.refused === "javascript:alert(1)" &&
			view.webContents.getURL() === before,
		refused,
	);

	await win.webContents
		.executeJavaScript(`location.href = ${JSON.stringify(`${foreign}/`)}`)
		.catch(() => {});
	await wait(500);
	check(
		"the app window does not leave its origin",
		win.webContents.getURL() === `${base}/app`,
		win.webContents.getURL(),
	);

	const perm = await view.webContents.executeJavaScript(
		`navigator.permissions.query({name:"geolocation"}).then(p=>p.state).catch(e=>String(e))`,
	);
	check("the view is refused permissions", perm === "denied", perm);

	// The guard itself, not Chromium's own rules: a mailto: link is refused and said (#977 OBJ-011).
	await view.webContents
		.executeJavaScript(`location.href = "mailto:ops@example.com"`)
		.catch(() => {});
	await wait(500);
	const said = await win.webContents.executeJavaScript("window.__s.at(-1)");
	check(
		"the view's guard refuses a page's mailto: and reports it",
		said?.refused === "mailto:ops@example.com" &&
			view.webContents.getURL() === before,
		said,
	);

	await win.webContents.executeJavaScript(
		`window.prismalensDesktop.browser.open(${JSON.stringify(`${base}/page`)})`,
	);
	await wait(800);
	const after = await win.webContents.executeJavaScript("window.__s.at(-1)");
	check("a good navigation clears the refusal", after?.refused === null, after);

	await view.webContents.executeJavaScript(
		`window.open(${JSON.stringify(`${base}/popup`)})`,
	);
	await wait(800);
	const blocked = await win.webContents.executeJavaScript("window.__s.at(-1)");
	check(
		"a popup opens nowhere and is named for the user (#977 OBJ-019)",
		BrowserWindow.getAllWindows().length === 1 &&
			view.webContents.getURL() === `${base}/page` &&
			blocked?.popup === `${base}/popup`,
		{ windows: BrowserWindow.getAllWindows().length, blocked },
	);

	// tel: and someapp: are not hosts: a page's link or its server's redirect to one is refused (#977 OBJ-017).
	for (const target of ["tel:123", "someapp:/path"]) {
		await view.webContents
			.executeJavaScript(`location.href = ${JSON.stringify(target)}`)
			.catch(() => {});
		await wait(500);
		const s = await win.webContents.executeJavaScript("window.__s.at(-1)");
		check(
			`the view's guard refuses a page's ${target}`,
			s?.refused === target && view.webContents.getURL() === `${base}/page`,
			s,
		);
	}
	await view.webContents
		.executeJavaScript(`location.href = ${JSON.stringify(`${base}/to-tel`)}`)
		.catch(() => {});
	await wait(800);
	check(
		"the view's guard refuses a redirect to tel:",
		!view.webContents.getURL().startsWith("tel:"),
		view.webContents.getURL(),
	);

	const started = Date.now();
	await view.webContents.executeJavaScript(`alert("x"); confirm("y"); 1`);
	check(
		"a page cannot raise native dialogs",
		Date.now() - started < 1000,
		Date.now() - started,
	);

	await win.webContents.executeJavaScript(
		`window.__s=[]; window.prismalensDesktop.browser.go("state")`,
	);
	await wait(300);
	const asked = await win.webContents.executeJavaScript("window.__s.at(-1)");
	check(
		"a panel that mounts again can ask where the view is",
		asked?.url?.startsWith(base) === true,
		asked,
	);

	await win.webContents.executeJavaScript(
		`window.prismalensDesktop.browser.go("clear")`,
	);
	await wait(800);
	check(
		"leaving a run stops its page and forgets its history (#977 OBJ-012)",
		view.webContents.getURL() === "about:blank" &&
			!view.webContents.navigationHistory.canGoBack() &&
			!view.getVisible(),
		{
			url: view.webContents.getURL(),
			back: view.webContents.navigationHistory.canGoBack(),
		},
	);

	const failed = Object.entries(results).filter(([, v]) => v !== "pass");
	log(failed.length ? `${failed.length} failed` : "all passed");
	server.close();
	other.close();
	app.exit(failed.length ? 1 : 0);
}
