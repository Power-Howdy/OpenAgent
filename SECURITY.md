# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in OpenAgent, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, please email us at **security@openagent.dev** with:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (if you have them)

We will acknowledge receipt within 48 hours and provide a more detailed response within 5 business days.

## Security Best Practices

When using OpenAgent, consider these security practices:

1. **API Keys**: Store API keys in environment variables or use the config system. Never commit keys to version control.

2. **Sandbox**: Untrusted code runs in the sandbox container. Keep the sandbox updated with `npm run setup`.

3. **MCP Servers**: Only connect to trusted MCP servers. Project servers require approval before running.

4. **Dependencies**: Run `npm audit` periodically to check for vulnerable dependencies.

5. **Permissions**: Review tool permissions before approving. Use plan mode (`/plan`) for complex changes.

## Disclosure Policy

When we receive a security report:

1. We confirm the vulnerability and assess impact
2. We develop a fix and prepare a release
3. We disclose the vulnerability publicly after users have time to upgrade
4. We credit the reporter (unless they request anonymity)

## Contact

For security concerns: **security@openagent.dev**

For general questions: Open a GitHub issue or discussion.