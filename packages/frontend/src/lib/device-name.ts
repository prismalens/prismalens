// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { desktopBridge } from "./desktop";

const BROWSERS: [RegExp, string][] = [
	[/Edg\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Firefox\/|FxiOS/, "Firefox"],
	[/Chrome\/|CriOS/, "Chrome"],
	[/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
	[/iPhone/, "iPhone"],
	[/iPad/, "iPad"],
	[/Android/, "Android"],
	[/Macintosh|Mac OS X/, "macOS"],
	[/Windows/, "Windows"],
	[/CrOS/, "ChromeOS"],
	[/Linux/, "Linux"],
];

const match = (ua: string, table: [RegExp, string][]) =>
	table.find(([re]) => re.test(ua))?.[1];

/** "Firefox on Linux" from a user agent; whichever half is known, or undefined. */
export function guessDeviceName(
	userAgent: string,
	isDesktop: boolean = Boolean(desktopBridge()),
): string | undefined {
	const browser = isDesktop ? "PrismaLens desktop" : match(userAgent, BROWSERS);
	const system = match(userAgent, SYSTEMS);
	if (browser && system) return `${browser} on ${system}`;
	return browser ?? system;
}

/** "Pixel 9" from an Android user agent that still names its model; reduced ones say "K". */
export function modelFromUserAgent(userAgent: string): string | undefined {
	const model = userAgent.match(/Android [\d.]+; ([^;)]+)\)/)?.[1]?.trim();
	if (model && model !== "K") return model.replace(/ Build\/.*$/, "");
	if (/iPhone/.test(userAgent)) return "iPhone";
	if (/iPad/.test(userAgent)) return "iPad";
	return undefined;
}

interface HighEntropyNavigator {
	userAgentData?: {
		getHighEntropyValues(hints: string[]): Promise<{ model?: string }>;
	};
}

/**
 * The name a device pairs under: its model where the browser tells it (client
 * hints, then the user agent), else "Chrome on Linux". The list shows the
 * browser beside it either way.
 */
export async function pairingName(nav: Navigator): Promise<string | undefined> {
	try {
		const hints = await (
			nav as Navigator & HighEntropyNavigator
		).userAgentData?.getHighEntropyValues(["model"]);
		if (hints?.model) return hints.model;
	} catch {
		// Client hints refused: fall back to the user agent.
	}
	return modelFromUserAgent(nav.userAgent) ?? guessDeviceName(nav.userAgent);
}
