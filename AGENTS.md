# AGENTS.md

## Setup commands

- Install dependencies: `npm install`
- Start the CLI: `npm start`
- Typecheck: `npm run typecheck`
- Run tests: `npm test`
- Run one test: `npm test -- --test-name-pattern="test name"`

## Code style

- TypeScript (ES2022, NodeNext) and React JSX
- ES modules and named exports. Use `lodash-es` for utilities
- Interfaces for object shapes. `type` for unions and aliases. `noImplicitAny` is off
- PascalCase for components and types, camelCase for functions and variables, UPPER_SNAKE for constants
- No semicolons, 2-space indent, trailing commas in multiline lists
- `async/await`. Memoize expensive work with `lodash-es/memoize`
- Function components. Hooks live in `src/hooks/`. The terminal UI uses Ink

## Testing

- Node's test runner with `node:assert/strict`
- Create fixtures with `mkdtempSync` and remove them in `finally`
- `npm test` checks coverage for the agent-logic files and fails if that coverage drops

## Project structure

- `src/entrypoints/cli.tsx` starts the CLI
- `src/commands/` holds slash commands
- `src/tools/` holds agent tools
- `src/components/` holds Ink components
- `src/services/` holds the provider, router, and stores
- `src/utils/` holds shared helpers
