# OpenAgent Code

OpenAgent is a terminal coding agent. It keeps the permission-gated tool loop and talks to Anthropic, OpenAI, OpenAI-compatible endpoints, or free mode.

## Run

```bash
npm install
npm start
```

The `openagent` command is `npm start` while developing. One-shot:

```bash
npm start -- -p "list the files in src/tools and say how many there are"
```

## Install

`npm run build` compiles the CLI to `dist/`. `./scripts/install.sh` builds it and links `openagent` into `~/.local/bin` (override the directory with `OPENAGENT_BIN_DIR`). After that, `openagent` runs the built files with Node and does not need `tsx`.

```bash
npm install
npm run build
./bin/openagent.js --version
```

## Providers

The first configured paid key selects the provider:

- `ANTHROPIC_API_KEY` or `openagent config set -g primaryApiKey ...`
- `OPENAI_API_KEY`
- `OPENAI_COMPATIBLE_API_KEY` with `OPENAGENT_BASE_URL`

Flags `--provider`, `--model`, and `--base-url` override that for one process.

With no paid key, OpenAgent uses free mode. Important work goes to NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) when a NIM key is set. Use `NVIDIA_API_KEY`, `--nvidia-api-key`, or `openagent config set -g nvidiaApiKey <key>`. Calls spread across capable models so one task stays under the free-tier request window. Thinking is off in free mode, so usage is a request count.

The local model is Qwen3-0.6B Q4. Its OpenAI-compatible endpoint defaults to `http://127.0.0.1:8080/v1`. Change it with `--local-base-url`, `OPENAGENT_LOCAL_BASE_URL`, or `openagent config set -g localBaseURL http://127.0.0.1:8080/v1`. Every local call is a new chat. It is used for bookkeeping such as command descriptions. It does not continue the agent thread. If NIM has no key, or every NIM model is cooling, the thread waits or stops with that reason.

## Memory and stores

Memory, the thread transcript, and thread context live under `~/.OpenAgent`. Project instructions in `AGENTS.md`, `CLAUDE.md`, and other agents' instruction files (`.cursor`, `.claude`, `.opencode`, and similar directories) are shared by every model on a thread. The closest file wins. Switching NIM models resends that same thread.

`~/.OpenAgent/tool-store` holds shared scripts. Capable models can save them. Any model can run them after the same permission prompt as the shell. The first save of a new id asks first.

`~/.OpenAgent/skill-store` mirrors [NVIDIA/skills](https://github.com/NVIDIA/skills) in the background. A skill is added to a turn only when it clearly matches.

MCP servers are tools from other agents. OpenAgent reads `.mcp.json`, `.mcprc`, `.cursor/mcp.json`, Claude settings, and OpenCode config, plus `openagent mcp add`. A project server asks for approval before it runs. `openagent mcp add-http <name> <url>` adds a remote server. Connected tools are available to the model as `mcp__server__tool`.

`~/.OpenAgent/blueprint-store` indexes NVIDIA AI Blueprints. A repo is cloned only when you read that blueprint. The agent writes its own blueprint only after a successful run with two or three independent workstreams and no stored match. A normal coding task stays on one thread.

## Sandbox and search

`npm run setup` builds `openagent-sandbox:local` and starts SearXNG at `http://127.0.0.1:18088`. Web search calls that local server. Untrusted snippets run in the sandbox. Project tests and package installs stay on the host unless a tool is asked to isolate them. `openagent sandbox down` stops session containers.

A custom tool is a JSON file in `.openagent/tools` or `~/.OpenAgent/plugins`:

```json
{ "name": "echo", "description": "Echo args", "argv": ["node", "/opt/tool.js"], "readonly": true }
```

The command runs inside the sandbox. Nothing from that file is imported into the agent process.

## Checks

```bash
npm run typecheck
npm test
```
