# ─────────────────────────────────────────────────────────────────────────────
# toolbox — lightweight interactive shell container for CyberpunkTerm users
# Base: Alpine 3.21  |  Final size target: < 50 MiB compressed
# ─────────────────────────────────────────────────────────────────────────────
FROM alpine:3.21

LABEL org.opencontainers.image.title="cyberpunkterm-toolbox" \
      org.opencontainers.image.description="Lightweight user shell for CyberpunkTerm" \
      org.opencontainers.image.version="0.1.0"

# Install essential shell tools in a single layer; clean up package cache
RUN apk add --no-cache \
      bash \
      bash-completion \
      curl \
      wget \
      git \
      vim \
      nano \
      jq \
      htop \
      procps \
      net-tools \
      bind-tools \
      iputils \
      openssh-client \
      ca-certificates \
      tzdata \
      less \
      file \
      tar \
      gzip \
      unzip \
  && update-ca-certificates

# Create a non-root user "toolbox" (uid/gid 1000)
RUN addgroup -g 1000 toolbox \
  && adduser -u 1000 -G toolbox -s /bin/bash -D toolbox

# Give the user a minimal .bashrc with a nice PS1
RUN printf '%s\n' \
      'export PS1="\[\033[01;32m\]toolbox\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' \
      'export TERM=xterm-256color' \
      'alias ll="ls -lah --color=auto"' \
      'alias la="ls -A --color=auto"' \
    > /home/toolbox/.bashrc \
  && chown toolbox:toolbox /home/toolbox/.bashrc

WORKDIR /home/toolbox
USER toolbox

CMD ["/bin/bash", "--login"]
