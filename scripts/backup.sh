#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir=${BACKUP_DIR:-"$project_dir/backups"}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/shiguang-$timestamp.dump"

umask 077
mkdir -p "$backup_dir"
cd "$project_dir"
docker compose exec -T database pg_dump -U shiguang -d shiguang --format=custom > "$target"

if [ ! -s "$target" ]; then
  rm -f "$target"
  echo "备份失败：输出文件为空。" >&2
  exit 1
fi

echo "数据库备份已写入 $target"
