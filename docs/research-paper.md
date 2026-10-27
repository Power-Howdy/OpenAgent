# OpenAgent Research Paper

This directory contains the research paper and related materials for OpenAgent.

## Paper

- `paper.pdf` - The published research paper (to be added)
- `paper.tex` - LaTeX source (to be added)

## Abstract

OpenAgent is a permission-gated terminal coding agent that supports multiple LLM providers including Anthropic, OpenAI, OpenAI-compatible endpoints, NVIDIA NIM free tier, and local models. It features a tool-use loop with sandbox execution, MCP server integration, and a novel free-mode routing system that distributes requests across capable models to stay within free-tier limits.

## Key Contributions

1. **Multi-provider architecture** - Unified interface for Anthropic, OpenAI, NIM, and local models
2. **Permission-gated tool loop** - User approval for each tool invocation
3. **Free-mode routing** - Intelligent request distribution across NIM models
4. **Sandbox execution** - Isolated environment for untrusted code
5. **MCP integration** - Compatible with Model Context Protocol servers
6. **Blueprint system** - Task decomposition for complex multi-workstream projects

## Citation

```bibtex
@software{openagent2024,
  title = {OpenAgent: A Multi-Provider Terminal Coding Agent},
  author = {OpenAgent Contributors},
  year = {2024},
  url = {https://github.com/severus/openagent}
}
```

## Related Work

- [NVIDIA/skills](https://github.com/NVIDIA/skills) - Skill store mirrored by OpenAgent
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP server standard
- [NVIDIA NIM](https://www.nvidia.com/en-us/nim/) - Free tier inference API

## Reproducing Experiments

See `experiments/` directory for reproduction scripts (to be added).