# @prismalens/api

The in-development NestJS REST API server for PrismaLens. This package is currently `private: true` and not part of the CLI release.

## Running locally

```bash
pnpm dev:api
```

## Single-tenant startup invariant

PrismaLens is single-tenant (ADR-0011 §6): one organization, multi-user inside it. At startup
the API asserts the database contains at most one organization and **refuses to boot** if it
finds more. If startup aborts with the single-tenant error, reduce the database to a single
organization (remove the extras and their memberships) and restart.

## License

Apache-2.0
