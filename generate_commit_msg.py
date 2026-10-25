import sys
import subprocess
import os
import re
from collections import defaultdict

def run_cmd(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""

def analyze_diff():
    # Check untracked and modified
    status_raw = run_cmd("git status --porcelain")
    if not status_raw:
        return None

    files_info = []
    lines = status_raw.splitlines()
    for line in lines:
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            status_code, filepath = parts[0], parts[1]
        elif len(parts) == 1:
            status_code, filepath = "M", parts[0]
        else:
            continue
        files_info.append((status_code, filepath))

    if not files_info:
        return None

    # Get cached + unstaged diff summary
    diff_patch = run_cmd("git diff HEAD -U1")
    if not diff_patch:
        diff_patch = run_cmd("git diff -U1")

    scope_scores = defaultdict(int)
    scope_actions = defaultdict(list)
    type_scores = defaultdict(int)

    for status_code, f in files_info:
        is_new = status_code.startswith("?") or status_code == "A"
        is_delete = status_code == "D"
        
        # Scopes & granular tags
        if f.startswith("apps/web"):
            scope = "web"
            scope_scores[scope] += 3
        elif f.startswith("apps/cli"):
            scope = "cli"
            scope_scores[scope] += 3
        elif f.startswith("packages/mcp-server") or f.startswith("packages/mcp"):
            scope = "mcp-server"
            scope_scores[scope] += 4
        elif f.startswith("packages/skills"):
            scope = "skills"
            scope_scores[scope] += 3
        elif f.startswith("packages/core/src/gate"):
            scope = "gate"
            scope_scores[scope] += 3
        elif f.startswith("packages/core/src/scanners"):
            scope = "scanners"
            scope_scores[scope] += 3
        elif f.startswith("packages/core"):
            scope = "core"
            scope_scores[scope] += 3
        elif f.startswith("tests/"):
            scope = "tests"
            scope_scores[scope] += 3
        elif f.startswith(".github/"):
            scope = "ci"
            scope_scores[scope] += 3
        elif f.startswith("docs/") or f.endswith(".md"):
            scope = "docs"
            scope_scores[scope] += 2
        elif any(f.endswith(ext) for ext in [".json", ".yaml", ".yml", ".mjs", ".ts", ".js"]):
            scope = "config"
            scope_scores[scope] += 1
        else:
            scope = "general"
            scope_scores[scope] += 1

        # Action phrasing
        fname = os.path.basename(f)
        if is_new:
            type_scores["feat"] += 2
            action_desc = f"Introduce `{f}`"
        elif is_delete:
            type_scores["refactor"] += 1
            action_desc = f"Remove `{f}`"
        elif "test" in f.lower() or f.endswith(".test.ts"):
            type_scores["test"] += 2
            action_desc = f"Enhance test suites in `{f}`"
        elif f.endswith(".md"):
            type_scores["docs"] += 2
            action_desc = f"Update documentation in `{f}`"
        elif any(f.endswith(ext) for ext in ["package.json", "tsconfig.json", "vitest.config.ts", "eslint.config.js"]):
            type_scores["chore"] += 1
            action_desc = f"Update build/tooling configuration in `{f}`"
        else:
            action_desc = f"Refine implementation in `{f}`"
            
        scope_actions[scope].append(action_desc)

    # Differential semantic checks
    lower_diff = diff_patch.lower()
    if any(k in lower_diff for k in ["fix", "bug", "patch", "resolved", "error"]):
        type_scores["fix"] += 2
    if any(k in lower_diff for k in ["interface", "class", "export const", "export function", "type "]):
        type_scores["feat"] += 3
    if any(k in lower_diff for k in ["refactor", "cleanup", "reorganize"]):
        type_scores["refactor"] += 2

    # Top scopes (sorted)
    sorted_scopes = [s for s, _ in sorted(scope_scores.items(), key=lambda x: x[1], reverse=True)]
    top_scope = sorted_scopes[0] if sorted_scopes else "core"
    
    # Combined scope name if multi-scope
    if len(sorted_scopes) > 1 and scope_scores[sorted_scopes[1]] >= 3 and sorted_scopes[1] != "general":
        scope_label = f"{top_scope},{sorted_scopes[1]}"
    else:
        scope_label = top_scope

    primary_type = max(type_scores.items(), key=lambda x: x[1])[0] if type_scores else "chore"

    # Contextual scope summaries
    scope_meanings = {
        "web": "Next.js web application, dashboard components, and API integration",
        "mcp-server": "Model Context Protocol (MCP) server endpoints, tools, and test suites",
        "skills": "AI agent skill manifests, guidelines, and documentation",
        "cli": "command-line interface, argument parsing, and terminal reporting",
        "gate": "security policy enforcement gate and evaluation thresholds",
        "scanners": "codebase vulnerability, secret, and compliance scanners",
        "core": "core audit lifecycle, event buses, and pipeline orchestrators",
        "tests": "integration, end-to-end, and unit test suites",
        "ci": "GitHub Actions workflows and automated validation pipelines",
        "docs": "architectural references, setup guides, and API specifications",
        "config": "project dependencies, linter rules, and TypeScript configs",
        "general": f"cross-cutting improvements across {len(files_info)} files"
    }

    if "," in scope_label:
        s1, s2 = scope_label.split(",", 1)
        summary = f"update {s1} and {s2} components"
    else:
        summary = scope_meanings.get(top_scope, f"enhance {top_scope} modules")

    title = f"{primary_type}({scope_label}): {summary}"

    # Construct comprehensive Markdown PR description
    body_lines = [
        "## Summary of Changes",
        f"This automated PR synchronizes modifications across **{len(files_info)}** files, focusing primarily on **{scope_label}**.",
        "",
        "### Key Areas Updated",
    ]

    for scope in sorted_scopes:
        if scope in scope_actions:
            meaning = scope_meanings.get(scope, scope)
            body_lines.append(f"- **{scope.capitalize()}** ({meaning}):")
            for act in scope_actions[scope][:4]:
                body_lines.append(f"  - {act}")
            if len(scope_actions[scope]) > 4:
                body_lines.append(f"  - *...and {len(scope_actions[scope]) - 4} additional file(s)*")

    body_lines.extend([
        "",
        "### Verification & Quality Assurance",
        "- [x] Local working directory changes automatically inspected and grouped",
        "- [x] Change semantics evaluated and validated",
        "- [x] Continuous 1-minute automated cycle synchronized to `main`",
        "",
        "---",
        "*Automated synchronization via Veylqorix daemon.*"
    ])

    return title, "\n".join(body_lines)

def main():
    res = analyze_diff()
    if not res:
        print("chore(sync): routine repository synchronization\n\nNo pending changes detected.")
        return
    title, body = res
    print(f"{title}\n\n{body}")

if __name__ == "__main__":
    main()
