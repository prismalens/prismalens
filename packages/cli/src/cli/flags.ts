// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import consola from "consola";

function kebabToCamel(str: string): string {
	return str.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
}

function camelToKebab(str: string): string {
	return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function assertKnownFlags(args: Record<string, unknown>, cmd: unknown) {
	const declaredArgs = (cmd as { args?: Record<string, unknown> })?.args || {};
	const allowedKeys = new Set<string>(["_"]);

	for (const key in declaredArgs) {
		if (Object.hasOwn(declaredArgs, key)) {
			allowedKeys.add(key);
			allowedKeys.add(kebabToCamel(key));
			allowedKeys.add(camelToKebab(key));
		}
	}

	for (const key in args) {
		if (Object.hasOwn(args, key)) {
			if (!allowedKeys.has(key)) {
				consola.error(`Unknown option: --${key}`);
				const rawArgs = process.argv.slice(2);
				const cmdName = `pl${rawArgs[0] && !rawArgs[0].startsWith("-") ? ` ${rawArgs[0]}` : ""}`;
				consola.info(`Run \`${cmdName} --help\` for usage.`);
				process.exit(1);
			}
		}
	}
}
