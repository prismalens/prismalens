# @prismalens/registry

The registry kernel: a kind declares its file suffix, schema, refs and guards; entries are
`define.<kind>(...)` calls in files with that suffix. `pnpm registry gen` writes the id
unions and the manifest the guards read. See https://prismalens.io.
