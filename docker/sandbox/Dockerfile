FROM node:22-bookworm

ARG LANGS=ts,py

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    sqlite3 \
    ripgrep \
    curl \
    ca-certificates \
    git \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:/usr/local/cargo/bin:${PATH}"
ENV LANGS=${LANGS}
RUN pip install --no-cache-dir debugpy pytest \
  && corepack enable \
  && mkdir -p /opt \
  && printf '%s' "${LANGS}" > /opt/openagent-langs \
  && chmod a+r /opt/openagent-langs

RUN if echo ",${LANGS}," | grep -q ",ts,"; then npm install -g typescript typescript-language-server; fi \
  && if echo ",${LANGS}," | grep -q ",py,"; then npm install -g pyright; fi

RUN if echo ",${LANGS}," | grep -q ",go,"; then \
      apt-get update && apt-get install -y --no-install-recommends golang \
      && rm -rf /var/lib/apt/lists/* \
      && GOBIN=/usr/local/bin go install golang.org/x/tools/gopls@latest; \
    fi

RUN if echo ",${LANGS}," | grep -q ",rust,"; then \
      curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
        | RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo sh -s -- -y --profile minimal \
      && RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo rustup component add rust-analyzer \
      && chmod -R a+rX /usr/local/rustup /usr/local/cargo; \
    fi

WORKDIR /workspace
