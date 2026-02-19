/**
 * Thin wrapper to prevent accidental logging/serialization of sensitive values.
 * Access the real value via .reveal(). toJSON/toString return [REDACTED].
 */
export class Secret<T> {
	#value: T;

	constructor(value: T) {
		this.#value = value;
	}

	/** Get the actual secret value. */
	reveal(): T {
		return this.#value;
	}

	toJSON(): string {
		return "[REDACTED]";
	}

	toString(): string {
		return "[REDACTED]";
	}

	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return "[REDACTED]";
	}
}
