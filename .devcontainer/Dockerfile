FROM node:24.13.0-bookworm-slim

# Shared, reviewed tool installation; services and local network policy are scripts.
COPY install-tools.sh /usr/local/share/p1/install-tools.sh
RUN /bin/sh /usr/local/share/p1/install-tools.sh

USER node
WORKDIR /workspaces/p1
