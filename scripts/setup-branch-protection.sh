#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-branch-protection.sh
#
# 配置 GitHub 分支保护规则，确保 CI workflow 通过才能合并。
# 前提条件：
#   1. 已安装 GitHub CLI (gh): https://cli.github.com/
#   2. 已认证: gh auth login
#   3. 仓库已推送至 GitHub: git remote add origin <url> && git push
#
# 用法:
#   bash scripts/setup-branch-protection.sh [branch]
#   默认分支: main
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BRANCH="${1:-main}"
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || {
  echo "❌ 无法获取仓库信息。请确认："
  echo "   1. 已安装 gh CLI: https://cli.github.com/"
  echo "   2. 已认证: gh auth login"
  echo "   3. 已配置 remote: git remote -v"
  exit 1
}

echo "📦 仓库: $REPO"
echo "🌿 分支: $BRANCH"
echo ""

# ── 配置分支保护规则 ─────────────────────────────────────────────────────────
# required_status_checks: 要求 CI status check 通过
# required_pull_request_reviews: 要求至少 1 人 review
# enforce_admins: 管理员也需遵守
# required_linear_history: 要求线性历史（禁止 merge commit）
# allow_force_pushes: 禁止 force push
# allow_deletions: 禁止删除分支

gh api "repos/$REPO/branches/$BRANCH/protection" \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, Build, Type Check, Test & E2E"
    ]
  },
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "enforce_admins": true,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
EOF

echo ""
echo "✅ 分支保护规则已配置："
echo "   • CI status check ('Lint, Build, Type Check, Test & E2E') 必须通过才能合并"
echo "   • 至少 1 人 review 通过"
echo "   • 过时 review 自动失效"
echo "   • 管理员也需遵守规则"
echo "   • 禁止 force push 和分支删除"
echo ""
echo "🔗 查看: https://github.com/$REPO/settings/branches"
