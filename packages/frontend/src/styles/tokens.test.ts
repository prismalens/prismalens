// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, createElement, type ElementType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("contrast nudges and 48 px touch targets (#848 case 20)", () => {
	const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8");

	it("nudges text-3, danger, live, ok, and warn text tokens for AA contrast on surface-3", () => {
		// Light theme tokens moved 0.02 to 0.06 L for AA on surface-3
		expect(css).toMatch(/--text-3:\s*oklch\(0\.5\s+0\.012\s+285\);/);
		expect(css).toMatch(/--danger:\s*oklch\(0\.5\s+0\.22\s+27\);/);
		expect(css).toMatch(/--live:\s*oklch\(0\.46\s+0\.11\s+195\);/);
		expect(css).toMatch(/--ok:\s*oklch\(0\.44\s+0\.14\s+160\);/);
		expect(css).toMatch(/--warn:\s*oklch\(0\.47\s+0\.15\s+75\);/);

		// Dark theme text-3 moved from 0.64 to 0.68
		const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
		expect(darkMatch).not.toBeNull();
		const darkContent = darkMatch ? darkMatch[1] : "";
		expect(darkContent).toMatch(/--text-3:\s*oklch\(0\.68\s+0\.012\s+285\);/);
	});

	it("enforces 48 px minimum height for controls on touch layouts", () => {
		const touchQueryMatch = css.match(
			/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/,
		);
		expect(touchQueryMatch).not.toBeNull();
		const touchBlock = touchQueryMatch ? touchQueryMatch[1] : "";

		// Header is 48px
		expect(touchBlock).toContain("--header-h: 48px;");

		// Touch target min-height: 48px
		expect(touchBlock).toContain("min-height: 48px;");
		expect(touchBlock).toContain('button:not([role="switch"])');
		expect(touchBlock).toContain('[role="tab"]');
		expect(touchBlock).toContain('[role="radio"]');
		expect(touchBlock).toContain('[role="option"]');
		expect(touchBlock).toContain('[role="menuitem"]');
		expect(touchBlock).toContain('[role="combobox"]');
		expect(touchBlock).toContain("select");
		expect(touchBlock).toContain('input:not([type="checkbox"], [type="radio"], [type="hidden"])');
		expect(touchBlock).toContain("nav a");
		expect(touchBlock).toContain("header a");
	});

	const TOUCH = "@media (pointer: coarse), (max-width: 767px)";
	const decls = (nodes: CssNode[] | undefined, prelude: string) =>
		Object.fromEntries(
			nodes?.find((n) => n.prelude === prelude)?.decls ?? [],
		);

	const touchRules = () =>
		parse(css).find((n) => n.prelude === TOUCH)?.children ?? [];
	const slotRule = () => touchRules().find((n) => n.prelude.includes("[data-slot"));

	it("gives every Button, asChild anchors included, a real 48 px box on touch", () => {
		expect(Object.fromEntries(slotRule()?.decls ?? [])).toEqual({
			"min-width": "48px",
			"min-height": "48px",
		});
		expect(css).not.toMatch(/\[data-slot="button"\][^{]*::after/);
	});

	it("covers exactly the ui slots a Button can carry, triggers included (OBJ-011)", () => {
		const prelude = slotRule()?.prelude ?? "";
		const tests = Array.from(prelude.matchAll(/\[data-slot([*^$]?)="([^"]+)"\]/g)).map(
			([, op, v]) =>
				(s: string) =>
					op === "$" ? s.endsWith(v) : op === "^" ? s.startsWith(v) : op === "*" ? s.includes(v) : s === v,
		);
		const uiDir = resolve(__dirname, "../components/ui");
		const slots = new Set(
			readdirSync(uiDir)
				.filter((f) => f.endsWith(".tsx"))
				.flatMap((f) => Array.from(readFileSync(join(uiDir, f), "utf8").matchAll(/data-slot="([^"]+)"/g)))
				.map((m) => m[1] as string),
		);
		expect(Array.from(slots).filter((s) => tests.some((t) => t(s))).sort()).toEqual([
			"button",
			"dropdown-menu-sub-trigger",
			"dropdown-menu-trigger",
		]);
	});

	it("matches a Button rendered as the asChild of every trigger", () => {
		const prelude = slotRule()?.prelude ?? "";
		const icon = createElement(Button, { size: "icon" }, "x");
		const asChild = (trigger: ElementType<{ asChild: boolean; children?: ReactNode }>) =>
			createElement(trigger, { asChild: true }, icon);
		const host = document.createElement("div");
		const root = createRoot(host);
		act(() =>
			root.render(
				createElement(
					TooltipProvider,
					null,
					createElement(DropdownMenu, null, asChild(DropdownMenuTrigger)),
					createElement(Popover, null, asChild(PopoverTrigger)),
					createElement(Tooltip, null, asChild(TooltipTrigger)),
					createElement(Dialog, null, asChild(DialogTrigger)),
				),
			),
		);
		const buttons = Array.from(host.querySelectorAll("button"));
		expect(buttons.map((b) => b.dataset.slot)).toEqual([
			"dropdown-menu-trigger",
			"button",
			"button",
			"button",
		]);
		for (const b of buttons) expect(b.matches(prelude)).toBe(true);
		act(() => root.unmount());
	});

	it("gives header links and buttons 48 px of width, the title link 48 px of height", () => {
		expect(
			decls(touchRules(), ':where(header button:not([role="switch"]), header a)'),
		).toEqual({ "min-width": "48px" });
		expect(decls(touchRules(), ':where([data-testid="incident-header"] h1 > a)')).toEqual({
			display: "block",
			overflow: "hidden",
			"text-overflow": "ellipsis",
			"line-height": "48px",
		});
	});

	it("keeps the phone incident header's actions on screen, the title 48 px wide (OBJ-011, OBJ-012)", () => {
		const phone = parse(css).find((n) => n.prelude === "@media (max-width: 639px)");
		const h = '[data-testid="incident-header"]';
		expect(decls(phone?.children, `:where(${h})`)).toEqual({
			"column-gap": "8px",
			"padding-right": "8px",
		});
		expect(decls(phone?.children, `:where(${h} > .font-mono, ${h} > .flex-1)`)).toEqual({
			display: "none",
		});
		expect(decls(phone?.children, `:where(${h} > h1)`)).toEqual({
			"min-width": "48px",
		});
		const narrow = parse(css).find((n) => n.prelude === "@media (max-width: 379px)");
		const dot = decls(
			narrow?.children,
			`:where(${h}:has([data-testid="details-toggle"]) [data-testid="header-severity"])`,
		);
		expect(dot).toMatchObject({ "font-size": "0", background: "currentColor" });
	});

	it("gives a switch a 48 px hit area that keeps its look", () => {
		const layer = parse(css).find((n) => n.prelude === "@layer base");
		const media = layer?.children.find((n) => n.prelude === TOUCH);
		expect(media).toBeDefined();
		expect(decls(media?.children, ':where([data-slot="switch"])')).toEqual({
			position: "relative",
		});
		const after = decls(media?.children, ':where([data-slot="switch"])::after');
		expect(after).toEqual({
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			width: "max(100%, 48px)",
			height: "max(100%, 48px)",
			transform: "translate(-50%, -50%)",
		});
	});
});

type CssNode = { prelude: string; decls: [string, string][]; children: CssNode[] };

/** Nested blocks with their declarations; enough for this file, no strings holding braces. */
function parse(src: string): CssNode[] {
	const root: CssNode = { prelude: "", decls: [], children: [] };
	const stack = [root];
	let buf = "";
	const decl = (node: CssNode, text: string) => {
		const i = text.indexOf(":");
		if (i > 0) node.decls.push([text.slice(0, i).trim(), text.slice(i + 1).trim()]);
	};
	for (const ch of src.replace(/\/\*[\s\S]*?\*\//g, "")) {
		const top = stack[stack.length - 1] as CssNode;
		if (ch === "{") {
			const node = { prelude: buf.trim().replace(/\s+/g, " "), decls: [], children: [] };
			node.prelude = node.prelude.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
			top.children.push(node);
			stack.push(node);
			buf = "";
		} else if (ch === "}") {
			decl(top, buf);
			stack.pop();
			buf = "";
		} else if (ch === ";") {
			if (stack.length > 1) decl(top, buf);
			buf = "";
		} else buf += ch;
	}
	return root.children;
}
