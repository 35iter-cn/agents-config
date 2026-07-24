---
name: git-checkout-latest
description: Checkout the latest remote default branch HEAD with dynamic remote/branch detection, dirty-tree guard, and retry. Use when user wants to sync to latest remote HEAD, or says "checkout latest origin/main".
---

# Git Checkout Latest

1. Run `${CLAUDE_SKILL_DIR}/scripts/git-checkout-latest.sh "$PWD"`.
2. Report the output to the user — both success and failure.

Do not ask for confirmation or read the script contents to the user.
