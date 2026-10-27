# Contributing to OpenAgent

Thank you for your interest in contributing to OpenAgent! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/power-howdy/openagent.git`
3. Install dependencies: `npm install`
4. Run the development version: `npm start`

## Development Workflow

### Making Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines

3. Run the type checker:
   ```bash
   npm run typecheck
   ```

4. Run the tests:
   ```bash
   npm test
   ```

5. Build the project to verify it compiles:
   ```bash
   npm run build
   ```

### Code Style

- TypeScript (ES2022, NodeNext) and React JSX
- ES modules and named exports. Use `lodash-es` for utilities
- Interfaces for object shapes. `type` for unions and aliases
- PascalCase for components and types, camelCase for functions and variables, UPPER_SNAKE for constants
- No semicolons, 2-space indent, trailing commas in multiline lists
- `async/await`. Memoize expensive work with `lodash-es/memoize`
- Function components. Hooks live in `src/hooks/`. The terminal UI uses Ink

### Commit Messages

Follow conventional commits format:
- `feat: add new feature`
- `fix: bug fix`
- `docs: documentation changes`
- `refactor: code refactoring`
- `test: add or update tests`
- `chore: maintenance tasks`

### Pull Request Process

1. Ensure all tests pass and typecheck is clean
2. Update documentation if needed
3. Add tests for new functionality
4. Submit a pull request with a clear description of the changes

## Project Structure

- `src/entrypoints/cli.tsx` - CLI entry point
- `src/commands/` - Slash commands
- `src/tools/` - Agent tools
- `src/components/` - Ink components (terminal UI)
- `src/services/` - Provider, router, and stores
- `src/utils/` - Shared helpers
- `test/` - Test files

## Testing

- Uses Node's test runner with `node:assert/strict`
- Create fixtures with `mkdtempSync` and remove them in `finally`
- `npm test` checks coverage for agent-logic files and fails if coverage drops

## Reporting Issues

- Search existing issues first
- Provide clear reproduction steps
- Include relevant logs and environment info
- Specify Node.js version and OS

## Security

Report security vulnerabilities privately. See [SECURITY.md](SECURITY.md) for details.