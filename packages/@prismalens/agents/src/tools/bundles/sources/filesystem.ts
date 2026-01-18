import * as fs from "fs/promises";
import * as path from "path";
import { Logger } from "@prismalens/logger";
import { manifestToMetadata, parseToolsManifest } from "../manifest.js";
import type {
	BundleExecutionContext,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
	ToolFactory,
	ToolManifest,
} from "../types.js";

// =============================================================================
// FILESYSTEM BUNDLE SOURCE
// =============================================================================
// Source for loading tool bundles from TOOLS.md manifests on disk.
// Similar to how skills are loaded from SKILL.md files.
// =============================================================================

const logger = new Logger({ context: "FilesystemBundleSource" });

const MANIFEST_FILENAME = "TOOLS.md";

/**
 * Configuration for FilesystemBundleSource.
 */
export interface FilesystemBundleSourceConfig {
	/** Root directory containing bundle folders */
	rootDir: string;

	/**
	 * Map of bundle names to tool factory functions.
	 * Required because TOOLS.md files don't contain executable code.
	 */
	factories: Record<string, ToolFactory>;
}

/**
 * Bundle source that loads from filesystem TOOLS.md manifests.
 */
export class FilesystemBundleSource implements ToolBundleSource {
	readonly name = "filesystem";
	private rootDir: string;
	private factories: Record<string, ToolFactory>;
	private manifestCache: Map<string, ToolManifest> = new Map();

	constructor(config: FilesystemBundleSourceConfig) {
		this.rootDir = config.rootDir;
		this.factories = config.factories;
	}

	/**
	 * Discover and list all bundles from the root directory.
	 * Scans for subdirectories containing TOOLS.md files.
	 */
	async listBundles(): Promise<ToolBundleMetadata[]> {
		const metadata: ToolBundleMetadata[] = [];

		try {
			// Check if root directory exists
			await fs.access(this.rootDir);
		} catch {
			logger.debug(`Root directory does not exist: ${this.rootDir}`);
			return metadata;
		}

		try {
			const entries = await fs.readdir(this.rootDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const manifestPath = path.join(
					this.rootDir,
					entry.name,
					MANIFEST_FILENAME,
				);

				try {
					const content = await fs.readFile(manifestPath, "utf-8");
					const manifest = parseToolsManifest(content);
					this.manifestCache.set(manifest.frontmatter.name, manifest);

					metadata.push(manifestToMetadata(manifest, this.name));
				} catch {
					// Skip directories without valid TOOLS.md
					logger.debug(`No valid TOOLS.md in ${entry.name}`);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to scan root directory: ${message}`);
		}

		logger.debug(`Found ${metadata.length} filesystem bundles in ${this.rootDir}`);
		return metadata;
	}

	/**
	 * Load a specific bundle by name.
	 */
	async loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null> {
		// Get cached manifest or try to find it
		let manifest = this.manifestCache.get(name);

		if (!manifest) {
			// Try to load from disk
			manifest = await this.findManifest(name);
			if (!manifest) {
				return null;
			}
			this.manifestCache.set(name, manifest);
		}

		// Get the factory function
		const factory = this.factories[name];
		if (!factory) {
			logger.warn(`No factory registered for bundle: ${name}`);
			return null;
		}

		return {
			metadata: manifestToMetadata(manifest, this.name),
			createTools: factory,
		};
	}

	/**
	 * Refresh the bundle list (clear cache and rescan).
	 */
	async refresh(): Promise<void> {
		this.manifestCache.clear();
		logger.debug("Cleared filesystem bundle cache");
	}

	/**
	 * Register a factory function for a bundle.
	 */
	registerFactory(bundleName: string, factory: ToolFactory): void {
		this.factories[bundleName] = factory;
	}

	/**
	 * Try to find a manifest by searching category directories.
	 */
	private async findManifest(name: string): Promise<ToolManifest | undefined> {
		try {
			const entries = await fs.readdir(this.rootDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const manifestPath = path.join(
					this.rootDir,
					entry.name,
					MANIFEST_FILENAME,
				);

				try {
					const content = await fs.readFile(manifestPath, "utf-8");
					const manifest = parseToolsManifest(content);

					if (manifest.frontmatter.name === name) {
						return manifest;
					}
				} catch {
					// Skip invalid manifests
				}
			}
		} catch {
			// Directory scan failed
		}

		return undefined;
	}
}

/**
 * Create a filesystem bundle source with factory registration.
 *
 * @example
 * const source = createFilesystemBundleSource({
 *   rootDir: "./src/tools/manifests",
 *   factories: {
 *     "github-code": createGitHubCodeTools,
 *     "render-logs": createRenderLogTools,
 *   },
 * });
 */
export function createFilesystemBundleSource(
	config: FilesystemBundleSourceConfig,
): FilesystemBundleSource {
	return new FilesystemBundleSource(config);
}
