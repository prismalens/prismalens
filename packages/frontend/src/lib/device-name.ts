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
