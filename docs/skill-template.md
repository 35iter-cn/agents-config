---
name: skill-name
description: One-line summary of what this skill does.
category: workflow  # workflow | coding | research | design
date_added: "YYYY-MM-DD"
---

## Overview

One sentence explaining the skill's purpose and output.

## When to Use

- Condition A
- Condition B
- Condition C

## When NOT to Use

- Condition that makes this skill inappropriate
- Another condition

## Quick Reference

<!-- LMB 定义行：仅 git 工作流相关 skill 需要 -->
<!-- **LMB** (Latest Main Branch) — remote HEAD branch ref. Detect: `git remote show origin | grep "HEAD branch" | awk '{print $NF}'`. **Always fetch before computing.** -->

### Step one

<!-- 如果需要引用子 skill： -->
<!-- **REQUIRED SUB-SKILL:** `sub-skill-name`. Description of what it does and why. -->

Description of what this step does. Include commands, conventions, and expected output.

### Step two

Description. Each step should be self-contained enough that someone can understand it without reading other steps.

### Step three

(Only as many steps as needed. Prefer 2-4.)

## Core Flow

```mermaid
flowchart TD
    A([Start]) --> B[Step one]
    B --> C[Step two]
    C --> D[Step three]
    D --> E([Done])
```

## Common Mistakes

- What people get wrong about this skill.
- Another common pitfall.

## Red Flags

- Behavior that should never happen.
- Another warning sign.
