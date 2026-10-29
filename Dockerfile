FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

ARG NODE_ENV=production

RUN NODE_OPTIONS=--max-old-space-size=2048 \
    npm_config_target_arch=${TARGETARCH} yarn build:app:docker && yarn build:server

FROM node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS runtime

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
WORKDIR /opt/setsquare-server
COPY --from=build /opt/node_app/setsquare-server/package.json ./package.json
COPY --from=build /opt/node_app/yarn.lock ./yarn.lock
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --production --frozen-lockfile --ignore-scripts
COPY --from=build /opt/node_app/setsquare-server/dist ./dist
COPY --from=build /opt/node_app/setsquare-server/migrations ./migrations
COPY --from=build /opt/node_app/setsquare-app/build /opt/setsquare-app/build

USER node
EXPOSE 3002
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
