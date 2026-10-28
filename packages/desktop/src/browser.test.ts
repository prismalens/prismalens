// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	BROWSER_PARTITION,
	browserWebPreferences,
	browserUrl,
	clampBounds,
	isAppOrigin,
	isGo,
	trustedSender,
	webUrl,
} from "./browser.js";

describe("browserUrl", () => {
	it.each([
		"https://grafana.internal/d/checkout",
		"http://127.0.0.1:9090/graph",
		"http://localhost:3000/",
		"http://10.0.0.5/health",
		"http://[::1]:8080/",
	])("opens %s, as T3 Code and Traycer do", (url) => {
		expect(browserUrl(url)?.href).toBe(new URL(url).href);
	});

	it.each([
		["localhost:3000/x", "http://localhost:3000/x"],
		["127.0.0.1:9090", "http://127.0.0.1:9090/"],
		["[::1]:8080", "http://[::1]:8080/"],
		["grafana.internal:3000", "https://grafana.internal:3000/"],
	])("reads %s with a port as an address, loopback as http (#977 OBJ-014)", (raw, href) => {
		expect(browserUrl(raw)?.href).toBe(href);
	});

	it("reads a bare host as https", () => {
		expect(browserUrl("grafana.example.com/d/x")?.href).toBe(
			"https://grafana.example.com/d/x",
		);
	});

	it.each([
		"file:///etc/passwd",
		"javascript:alert(1)",
		"data:text/html,<script>1</script>",
		"chrome://settings",
		"devtools://devtools/bundled/inspector.html",
		"view-source:https://example.com",
		"about:blank",
		"blob:https://example.com/1",
		"https://user:pass@example.com/",
		"ftp://example.com/",
		"",
		"   ",
	])("refuses %j", (url) => {
		expect(browserUrl(url)).toBeNull();
	});
});

describe("browserWebPreferences", () => {
	it("isolates the view: sandboxed, no Node, no preload, a session that is not kept or shared", () => {
		const prefs = browserWebPreferences(true);
		expect(prefs.sandbox).toBe(true);
		expect(prefs.contextIsolation).toBe(true);
		expect(prefs.nodeIntegration).toBe(false);
		expect(prefs.nodeIntegrationInSubFrames).toBe(false);
		expect(prefs.webviewTag).toBe(false);
		expect(prefs.preload).toBeUndefined();
		expect(prefs.webSecurity).toBe(true);
		expect(prefs.partition).toBe(BROWSER_PARTITION);
		expect(BROWSER_PARTITION.startsWith("persist:")).toBe(false);
		expect(prefs.devTools).toBe(false);
		expect(prefs.disableDialogs).toBe(true);
	});
});

describe("webUrl", () => {
	it.each([
		"tel:123",
		"ms-settings:",
		"someapp:/path",
		"mailto:ops@example.com",
		"localhost:3000",
	])("a navigation to %j is not a web page (#977 OBJ-017)", (url) => {
		expect(webUrl(url)).toBeNull();
	});
	it("takes a full http(s) URL as it is", () => {
		expect(webUrl("http://127.0.0.1:9090/x")?.href).toBe(
			"http://127.0.0.1:9090/x",
		);
	});
});

describe("clampBounds", () => {
	const size = { width: 1280, height: 800 };
	it("rounds to whole pixels inside the window", () => {
		expect(clampBounds({ x: 10.4, y: 20.6, width: 500.5, height: 300 }, size)).toEqual({
			x: 10,
			y: 21,
			width: 501,
			height: 300,
		});
	});
	it("keeps a rect that overflows inside the window", () => {
		expect(clampBounds({ x: 1000, y: 700, width: 900, height: 900 }, size)).toEqual({
			x: 1000,
			y: 700,
			width: 280,
			height: 100,
		});
	});
	it.each([
		null,
		{ x: Number.NaN, y: 0, width: 1, height: 1 },
		{ x: 0, y: 0, width: 0, height: 10 },
		{ x: -5000, y: 0, width: 10, height: 10 },
		{ x: "1", y: 0, width: 10, height: 10 },
	])("refuses %j", (rect) => {
		expect(clampBounds(rect, size)).toBeNull();
	});
});

describe("trustedSender", () => {
	const app = "http://127.0.0.1:3001";
	const main = { id: 1 };
	const frame = (url: string, parent: unknown = null) => ({ url, parent });
	it("takes a message from the app's own top frame in the app window", () => {
		expect(
			trustedSender({ sender: main, senderFrame: frame(`${app}/incidents`) }, main, app),
		).toBe(true);
	});
	it.each([
		["another webContents", { sender: { id: 2 }, senderFrame: frame(`${app}/`) }],
		["a foreign origin in the window", { sender: main, senderFrame: frame("https://evil.example/") }],
		["a look-alike origin", { sender: main, senderFrame: frame("http://127.0.0.1:3001.evil/") }],
		["a subframe", { sender: main, senderFrame: frame(`${app}/`, {}) }],
		["no frame", { sender: main, senderFrame: null }],
	])("refuses %s", (_name, event) => {
		expect(trustedSender(event, main, app)).toBe(false);
	});
});

describe("isGo", () => {
	it("takes the four moves, a state request and a clear, nothing else", () => {
		for (const g of ["back", "forward", "reload", "external", "state", "clear"])
			expect(isGo(g)).toBe(true);
		expect(isGo("close")).toBe(false);
	});
});

describe("isAppOrigin", () => {
	it("compares origins, not prefixes", () => {
		const app = "http://127.0.0.1:3001";
		expect(isAppOrigin("http://127.0.0.1:3001/settings", app)).toBe(true);
		expect(isAppOrigin("http://127.0.0.1:3001.evil/", app)).toBe(false);
		expect(isAppOrigin("not a url", app)).toBe(false);
	});
});
