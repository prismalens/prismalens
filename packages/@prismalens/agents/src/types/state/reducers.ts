/**
 * Reusable Reducer Functions
 *
 * Common reducer patterns extracted for reuse across state annotations.
 * All reducers are pure functions that return new values (immutable).
 */

/**
 * Append-only reducer for arrays.
 * Adds new items to the end of the existing array.
 */
export const appendReducer = <T>(current: T[], update: T[]): T[] => [
	...current,
	...update,
];

/**
 * Replace reducer that only updates if new value is defined.
 * Useful for optional fields that should only update when explicitly set.
 */
export const replaceReducer = <T>(current: T, update: T | undefined): T =>
	update ?? current;

/**
 * Merge reducer for objects.
 * Shallow merges the update into the current object.
 */
export const mergeReducer = <T extends object>(
	current: T,
	update: Partial<T>,
): T => ({ ...current, ...update });

/**
 * Unique set reducer for arrays.
 * Combines arrays and removes duplicates.
 */
export const uniqueSetReducer = <T>(prev: T[], next: T[]): T[] => [
	...new Set([...prev, ...next]),
];

/**
 * Latest wins reducer.
 * Simply returns the new value, ignoring the current value.
 */
export const latestWinsReducer = <T>(_current: T, update: T): T => update;

/**
 * Nullable replace reducer.
 * Similar to replaceReducer but explicitly handles null values.
 */
export const nullableReplaceReducer = <T>(
	current: T | null,
	update: T | null | undefined,
): T | null => (update === undefined ? current : update);
