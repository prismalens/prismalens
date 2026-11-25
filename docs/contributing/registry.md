# The registry

Anything a user can see, run, set or bind is declared once, as an entry of a **kind**. Every package reads entries through one kernel, `@prismalens/registry`. Drift fails `pnpm registry gen`, which `pnpm install` runs, so it also fails CI.

## Hosts

A host is a package with a `registry.config.json`. Its kinds live in its `kinds` folder and its entries in files with each kind's suffix. `registry.workspace.json` at the root lists every host and the import boundaries between packages. A host config that sets `workspace` makes the CLI read and check them all.

| Host | `collect` | Kinds | Read by |
|---|---|---|---|
| `packages/frontend` | `source` (default): literals read from source; a Vite glob loads the entries | action, block, condition, lens, setting, surface | the app, vitest |
| `packages/@prismalens/providers` | `module`: Node imports the files and writes a static barrel (not in git) | provider, entryPoint | the API, the engine, scripts, the UI |

The providers host joins `registry.workspace.json` with its first family, because the `populated` guard refuses a kind without entries. Pick `module` for a kind the server reads, and keep its entry files free of build-only imports. Descriptors import nothing built, so `gen` runs before any build.

## Add an entry

Run `pnpm registry where "<thing>"` to see which kind it is, then `pnpm new <kind> <id>`. A provider is `pnpm new provider <family>.<member>`, for example `pnpm new provider code-host.gitea`. Once its host is in the workspace, that command writes three things:
- the descriptor, with every required entry point of its family already listed;
- its fixtures;
- the barrel entry.

Fill the descriptor in, then run `pnpm registry gen`. Its guards name anything the entry still lacks. A member may skip a family check only through `skips: [{ case, reason }]`; the kit prints the reason in the test name.

## Add a kind

`pnpm new kind <name>` scaffolds a frontend kind. A module kind is a `defineKind` file in the providers host's `src/kinds`. Every kind needs at least one guard, and the kernel adds four: unique, fresh, refs and populated. The `populated` guard means a kind lands together with its first entry.

## Add a guard

A guard is `guard(name, fix, check)` in its kind's file. `check` gets the manifest and the live entries, and returns one sentence per problem. Its `fix` says what to do; `c.live(kind)` gives the runtime values.

## Stored ids

An id the database stores is declared on its entry as `stored: [{ column, value, where? }]`. `where` tells apart members that share one value, such as `git-host-token` rows by host. `stored-ids.tsv` records every shipped claim and is append-only. `pnpm registry gen --write-ledger` appends new rows. A package's own `registry:gen` passes `--own-host`, so it writes only its files while still checking every host. Removing a row or changing its owner needs the `registry-approved` label; rename an entry through `aliases` instead.

## Boundaries

`registry.workspace.json` `boundaries` forbid imports across packages. Examples: a screen importing the providers kit, agent-host importing the registry, or a descriptor importing built packages. `gen` names each crossing by file and specifier.

## Paid modules

A module adds members at runtime with `ProviderRegistry.contribute(moduleName, members)` from its `onModuleInit`. A duplicate id or unknown family throws, naming the module. A stored id that no installed module provides reads as unavailable, and its data is kept.
