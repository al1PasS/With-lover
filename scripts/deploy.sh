#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -f .env ]; then
  echo "缺少 .env。请先执行: cp .env.example .env，并填写真实配置。" >&2
  exit 1
fi

database_password=$(sed -n 's/^DATABASE_PASSWORD=//p' .env | tail -n 1)
domain=$(sed -n 's/^DOMAIN=//p' .env | tail -n 1)
cookie_secure=$(sed -n 's/^COOKIE_SECURE=//p' .env | tail -n 1)

case "$database_password" in
  ""|replace-with-a-long-random-password)
    echo "DATABASE_PASSWORD 尚未设置为真实随机密码。" >&2
    exit 1
    ;;
esac

if [ "${#database_password}" -lt 24 ]; then
  echo "DATABASE_PASSWORD 至少需要 24 个字符。" >&2
  exit 1
fi

if [ -z "$domain" ] || [ "$domain" = "memories.example.com" ]; then
  echo "DOMAIN 尚未设置为真实域名。" >&2
  exit 1
fi

if [ "$cookie_secure" != "true" ]; then
  echo "正式部署必须设置 COOKIE_SECURE=true。" >&2
  exit 1
fi

docker compose -f compose.yaml -f compose.prod.yaml config >/dev/null
docker compose -f compose.yaml -f compose.prod.yaml up -d --build --remove-orphans

echo "部署已启动。首次部署请运行 ./scripts/init-accounts.sh 初始化两个账户。"
echo "查看状态: docker compose -f compose.yaml -f compose.prod.yaml ps"
