// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A schema built on first use: the contract declares hundreds, and building them all when a
 * module loads was most of a page's start-up task (#1101 category 12). The proxy forwards every
 * read to the built schema, so callers, `instanceof` and `z.infer` see the schema itself.
 */
export function lazySchema<T extends object>(build: () => T): T {
	let real: T | undefined;
	const get = (): T => {
		real ??= build();
		return real;
	};
	return new Proxy({} as T, {
		get: (_, key) => Reflect.get(get(), key),
		has: (_, key) => Reflect.has(get(), key),
		set: (_, key, value) => Reflect.set(get(), key, value),
		ownKeys: () => Reflect.ownKeys(get()),
		getOwnPropertyDescriptor: (_, key) => {
			const d = Reflect.getOwnPropertyDescriptor(get(), key);
			// The empty target has no such property, so the proxy may only report it configurable.
			return d && { ...d, configurable: true };
		},
		getPrototypeOf: () => Reflect.getPrototypeOf(get()),
	});
}
