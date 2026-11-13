// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { whenIdle } from "@/lib/lazy";

/**
 * Faces added after the first layout are not fetched on their own, and the stylesheet's
 * faces register a frame after its import resolves: so wait a frame, then load the UI cut.
 */
function loadUiFace(): void {
	requestAnimationFrame(() => {
		document.fonts.forEach((face) => {
			if (
				face.family.includes("IBM Plex Sans Variable") &&
				face.unicodeRange.startsWith("U+20-7E") &&
				face.status === "unloaded"
			)
				void face.load().catch(() => {});
		});
	});
}

/**
 * Loads the interface font's faces once the page has loaded and gone idle, so the first
 * paint costs no font bytes; until then text draws in a fallback sized to Plex's metrics,
 * and the swap moves nothing (#1101 category 12, `scripts/fonts.mjs`).
 */
export function useLateFonts(): void {
	useEffect(() => {
		let cancel = () => {};
		const start = () => {
			cancel = whenIdle(
				() => void import("@/styles/fonts.css").then(loadUiFace),
			);
		};
		if (document.readyState === "complete") start();
		else window.addEventListener("load", start, { once: true });
		return () => {
			window.removeEventListener("load", start);
			cancel();
		};
	}, []);
}
