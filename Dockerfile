FROM node:20-bookworm-slim AS frontend

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_ASSURANCE_V1=true
ENV VITE_ASSURANCE_V1=${VITE_ASSURANCE_V1}
RUN pnpm build:prod

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS runtime

WORKDIR /app/runtime
COPY runtime/pyproject.toml runtime/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY runtime/reagent_runtime ./reagent_runtime
COPY --from=frontend /app/dist /app/dist

ENV PATH="/app/runtime/.venv/bin:${PATH}"
ENV REAGENT_DATA_DIR=/data
ENV REAGENT_STATIC_DIR=/app/dist
ENV REAGENT_ASSURANCE_V1=true

EXPOSE 8000
CMD ["sh", "-c", "uvicorn reagent_runtime.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
