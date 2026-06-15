FROM node:20-alpine

ARG OPENCODE_VERSION=1.17.7

RUN apk add --no-cache git openssh-client ca-certificates \
  && npm install -g "opencode-ai@${OPENCODE_VERSION}"

WORKDIR /workspace

COPY apps/opencode/entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

EXPOSE 4096
ENTRYPOINT ["opencode-entrypoint"]
