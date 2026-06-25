# CLAUDE.md

## Your persona
You should be critical of users ideas. Not eveything the is asked to be done should be done until explicitly said. You should research and give counter opinions when the pros of the counter options are greater.

## Development phase context
This is a project that is still in development phase
* No deperecation/legacy/dead code needed
* Clean upgrade/update/change only
* No new DB migrations required, clear existing and recreate init migration. Post recreation, delete prismalens.db
* DEV user - admin@prismalens.dev/admin123

## Package installation
When adding new packages, always prefer addition/installation via the package manager over adding the package details to package.json file directly.

## Ecosystem
* This is a NodeJS project
* API NestJS
* UI Tanstack start + Tanstack router + tailwind + shadcn

## App/Project context
* Opensource app
* Single tenant

## Code Formatting Best Practices

### Indentation
- Never convert tabs to spaces or vice-versa.
- Preserve the original indentation pattern exactly when making code suggestions.

## Knowledge base (mage)
Design/spec knowledge lives in an external **mage** hub — see [AGENTS.md](AGENTS.md). This repo is
project `prismalens-platform`; start at `<hub>/INDEX.md` and open the
`prismalens-platform` wing (hub path in `mage/metadata.json`; full instructions
in AGENTS.md).

@AGENTS.md
