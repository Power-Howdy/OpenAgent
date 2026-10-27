# Experiments

This directory contains scripts and configurations for reproducing experiments from the research paper.

## Scripts

- `benchmark.ts` - Provider benchmark comparing latency, cost, and quality across providers
- `free-mode.ts` - Free mode routing evaluation across NIM models

## Running Experiments

```bash
# Install dependencies
npm install

# Run provider benchmark (requires at least one API key)
npm run experiment:benchmark

# Run free mode evaluation (requires NVIDIA_API_KEY)
npm run experiment:free-mode
```

## Provider Benchmark

Compares Anthropic, OpenAI, NIM, and local models on:
- Latency (ms)
- Token count
- Success rate

Requires at least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`, or local model running at `http://127.0.0.1:8080/v1`

## Free Mode Evaluation

Tests the free-mode router's request distribution across NIM models:
- Routing distribution
- Budget utilization
- Cooldown behavior
- Sticky model retention

Requires: `NVIDIA_API_KEY`