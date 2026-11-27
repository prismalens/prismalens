// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The design matrix's per-page measure (#1020): small targets, phone tap overlaps, clipped
 * text and the main area's control count. Runs in the page through `page.evaluate`, so it
 * closes over nothing.
 */
export function measurePage() {
	const sel =
		"button, a[href], input:not([type=hidden]), textarea, [role=button], [role=tab], [role=combobox], [role=switch], [role=menuitem]";
	const shown = (el: HTMLElement) => {
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
	};
	const main = document.querySelector<HTMLElement>("main");
	const controls = main
		? Array.from(main.querySelectorAll<HTMLElement>(sel)).filter(shown).length
		: 0;
	const small: { name: string; w: number; h: number }[] = [];
	const overlaps: string[] = [];
	// What a finger hits: the box, widened by a centred ::after tap area (tokens.css, #848).
	const hitOf = (el: HTMLElement) => {
		const r = el.getBoundingClientRect();
		const a = getComputedStyle(el, "::after");
		const on = a.content !== "none" && a.position === "absolute";
		const w = Math.max(r.width, on ? Number.parseFloat(a.width) || 0 : 0);
		const h = Math.max(r.height, on ? Number.parseFloat(a.height) || 0 : 0);
		const x = r.left + r.width / 2;
		const y = r.top + r.height / 2;
		return {
			left: x - w / 2,
			right: x + w / 2,
			top: y - h / 2,
			bottom: y + h / 2,
			w,
			h,
		};
	};
	const phoneHits: { el: HTMLElement; box: ReturnType<typeof hitOf> }[] = [];
	const nameOf = (el: HTMLElement) =>
		(el.getAttribute("aria-label") ?? el.textContent ?? el.tagName)
			.trim()
			.slice(0, 40);
	for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight)
			continue;
		if (el.closest(".tsqd-parent-container")) continue;
		const box = hitOf(el);
		if (box.w < 24 || box.h < 24)
			small.push({
				name: nameOf(el),
				w: Math.round(box.w),
				h: Math.round(box.h),
			});
		if (innerWidth < 768) {
			// A finger meets only the part its scroll panes show: a row past the pane's edge is cut there (#1238).
			const cut = { ...box };
			for (
				let p = el.parentElement;
				p && p !== document.body;
				p = p.parentElement
			) {
				const s = getComputedStyle(p);
				if (s.overflowX === "visible" && s.overflowY === "visible") continue;
				const r = p.getBoundingClientRect();
				cut.left = Math.max(cut.left, r.left);
				cut.right = Math.min(cut.right, r.right);
				cut.top = Math.max(cut.top, r.top);
				cut.bottom = Math.min(cut.bottom, r.bottom);
			}
			if (cut.right > cut.left && cut.bottom > cut.top)
				phoneHits.push({ el, box: cut });
		}
	}
	// The sticky or fixed layer a control rides in, if any: the header and the composer.
	const layerOf = (el: HTMLElement) => {
		for (let n: HTMLElement | null = el; n; n = n.parentElement) {
			const p = getComputedStyle(n).position;
			if (p === "sticky" || p === "fixed") return n;
		}
		return null;
	};
	// A layer drawn over the overlap covers the other control there: a finger meets the layer (#1238).
	const covered = (a: HTMLElement, b: HTMLElement, cx: number, cy: number) => {
		const la = layerOf(a);
		const lb = layerOf(b);
		if (la === lb) return false;
		return [la, lb].some((l) => {
			if (!l) return false;
			const r = l.getBoundingClientRect();
			return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
		});
	};
	// Two tap areas that overlap give one control the other's taps: neighbours sit 12 px apart.
	phoneHits.forEach((a, i) => {
		for (const b of phoneHits.slice(i + 1)) {
			if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
			const left = Math.max(a.box.left, b.box.left);
			const top = Math.max(a.box.top, b.box.top);
			const x = Math.min(a.box.right, b.box.right) - left;
			const y = Math.min(a.box.bottom, b.box.bottom) - top;
			if (x > 0.5 && y > 0.5 && !covered(a.el, b.el, left + x / 2, top + y / 2))
				overlaps.push(
					`${nameOf(a.el)} / ${nameOf(b.el)} ${Math.round(x)}x${Math.round(y)}`,
				);
		}
	});
	const clip: string[] = [];
	for (const el of Array.from(
		document.querySelectorAll<HTMLElement>("body *"),
	)) {
		if (el.children.length > 0 || !el.textContent?.trim()) continue;
		const s = getComputedStyle(el);
		const hides = s.overflowX !== "visible" || s.overflowY !== "visible";
		if (!hides) continue;
		const cut =
			el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== "ellipsis";
		const cutV =
			el.scrollHeight > el.clientHeight + 2 &&
			s.overflowY === "hidden" &&
			!s.webkitLineClamp?.match(/\d/);
		// Screen-reader-only text is clipped to 1 px on purpose.
		if ((cut || cutV) && el.getBoundingClientRect().width > 1)
			clip.push(el.textContent.trim().slice(0, 60));
	}
	return {
		smallTargets: small,
		tapOverlaps: overlaps.slice(0, 20),
		clipped: clip.slice(0, 20),
		controls,
	};
}
