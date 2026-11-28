#!/bin/bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"
SOURCE_DB_DIR="$PROJECT_DIR/db"
SOURCE_DB_PATH="$SOURCE_DB_DIR/custom.db"
TARGET_DB_DIR="$BUILD_DIR/db"
TARGET_DB_PATH="$TARGET_DB_DIR/custom.db"

mkdir -p "$TARGET_DB_DIR"

if [ -f "$SOURCE_DB_PATH" ]; then
    echo "🗄️  复制 Preview 数据库到构建产物..."
    cp -a "$SOURCE_DB_DIR/." "$TARGET_DB_DIR/"
else
    echo "ℹ️  未找到 Preview 数据库 db/custom.db，将初始化空的生产数据库"
fi

echo "🗄️  同步构建产物中的数据库结构（迁移链部署，失败即中止）..."
# OPS-1E: 生产构建路径必须使用 prisma migrate deploy（与
# docs/PHASE2A_DATABASE_MIGRATIONS.md 的迁移策略一致），绝不使用
# prisma db push（db push 会掩盖迁移链漂移，且可能静默丢弃数据）。
# migrate deploy 遇到任何迁移错误都会非零退出，set -e 使构建立即失败
# （fail closed），绝不自动 reset、绝不 --accept-data-loss。
# 注意：若复制的已有数据库是旧版 db push 产物（没有 _prisma_migrations
# 迁移历史），migrate deploy 会诚实地报错失败——该库需要按迁移链重建；
# 这里不做任何静默基线化（silent baseline）来掩盖损坏的迁移历史。
(
    cd "$PROJECT_DIR"
    DATABASE_URL="file:$TARGET_DB_PATH" bun run db:deploy
)

if [ ! -f "$TARGET_DB_PATH" ]; then
    echo "❌ 数据库初始化命令执行成功，但未生成 $TARGET_DB_PATH"
    exit 1
fi

echo "✅ 构建产物数据库已准备完成"
ls -lah "$TARGET_DB_DIR"
