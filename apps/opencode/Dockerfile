FROM node:20-alpine

RUN apk add --no-cache git openssh-client ca-certificates \
  && npm install -g opencode-ai@latest

WORKDIR /workspace

COPY apps/opencode/entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

EXPOSE 4096
ENTRYPOINT ["opencode-entrypoint"]
