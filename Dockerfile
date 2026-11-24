# Imagem única do Pegada: o PocketBase serve a API, as regras do método
# (pb_hooks), as migrations e as telas já compiladas (pb_public).

# 1) Compila as telas
FROM node:22-alpine AS telas
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# 2) Servidor
FROM alpine:3.22
ARG PB_VERSION=0.28.4
ARG PB_SHA256=44161d9e8838d3226fee7f2a857b8033f642ace1f3486a1125b99fd6b8b08532
RUN wget -q -O /tmp/pb.zip https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
 && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
 && mkdir -p /pb && unzip -q /tmp/pb.zip -d /pb && rm /tmp/pb.zip
COPY pocketbase/hooks /pb/pb_hooks
COPY pocketbase/migrations /pb/pb_migrations
COPY --from=telas /app/dist /pb/pb_public
EXPOSE 8080
# Os dados ficam no volume montado em /pb_data (veja fly.toml).
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080", "--dir=/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations", "--publicDir=/pb/pb_public"]
