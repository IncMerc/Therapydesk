#!/bin/bash
# app_user doesn't own the tables, so RLS always applies to it
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}';
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO app_user;
SQL
