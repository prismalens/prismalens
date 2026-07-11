import consola from "consola";

function kebabToCamel(str: string): string {
	return str.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
}

export function assertKnownFlags(args: Record<string, unknown>, cmd: unknown) {
	const declaredArgs = (cmd as { args?: Record<string, unknown> })?.args || {};
	const allowedKeys = new Set<string>(["_"]);

	for (const key in declaredArgs) {
		if (Object.hasOwn(declaredArgs, key)) {
			allowedKeys.add(key);
			allowedKeys.add(kebabToCamel(key));
		}
	}

	for (const key in args) {
		if (Object.hasOwn(args, key)) {
			if (!allowedKeys.has(key)) {
				consola.error(`Unknown option: --${key}`);
				process.exit(1);
			}
		}
	}
}
