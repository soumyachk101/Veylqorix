import sys
import subprocess
from collections import defaultdict

def run_git(cmd):
    return subprocess.check_output(cmd, shell=True, text=True).strip()

def main():
    status_raw = run_git("git status --porcelain")
    if not status_raw:
        print("chore: routine repository synchronization\n\nNo substantive changes detected.")
        return

    staged_files = []
    lines = status_raw.splitlines()
    for line in lines:
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            staged_files.append((parts[0], parts[1]))
        elif len(parts) == 1:
            staged_files.append(("M", parts[0]))

    type_counts = defaultdict(int)
    module_counts = defaultdict(int)
    all_files = [f for _, f in staged_files]

    for status, filepath in staged_files:
        # Determine module/scope
        if filepath.startswith("packages/core/src/scanners/"):
            module_counts["scanners"] += 1
        elif filepath.startswith("packages/core/src/gate"):
            module_counts["gate"] += 1
        elif filepath.startswith("packages/core"):
            module_counts["core"] += 1
        elif filepath.startswith("packages/mcp-server"):
            module_counts["mcp-server"] += 1
        elif filepath.startswith("packages/plugin"):
            module_counts["plugin"] += 1
        elif filepath.startswith("apps/"):
            module_counts["apps"] += 1
        elif filepath.startswith("docs/"):
            module_counts["docs"] += 1
        elif filepath.startswith("tests/"):
            module_counts["tests"] += 1
        elif filepath.startswith(".github/"):
            module_counts["ci"] += 1
        else:
            module_counts["root"] += 1

        # Determine type
        if "test" in filepath:
            type_counts["test"] += 1
        elif filepath.endswith(".md"):
            type_counts["docs"] += 1
        elif any(filepath.endswith(x) for x in ["package.json", "pnpm-lock.yaml", "tsconfig.json", "yaml", "yml"]):
            type_counts["chore"] += 1
        else:
            type_counts["feat"] += 1

    # Choose primary scope & primary commit type
    primary_scope = max(module_counts.items(), key=lambda x: x[1])[0]
    primary_type = max(type_counts.items(), key=lambda x: x[1])[0]

    if primary_scope == "root":
        primary_scope = "repo"

    # Contextual description
    if primary_scope == "scanners":
        desc = "update security and quality scanner implementations"
    elif primary_scope == "gate":
        desc = "enhance quality gate policies and verification logic"
    elif primary_scope == "core":
        desc = "update core business logic and engine utilities"
    elif primary_scope == "mcp-server":
        desc = "update MCP server endpoints and tool definitions"
    elif primary_scope == "tests":
        desc = "expand test suites and verification cases"
    elif primary_scope == "docs":
        desc = "update documentation and architectural references"
    elif primary_scope == "ci":
        desc = "update workflows and CI/CD automation pipelines"
    else:
        desc = f"sync updates across {len(all_files)} file{'s' if len(all_files) > 1 else ''}"

    title = f"{primary_type}({primary_scope}): {desc}"

    # Generate detailed body
    body_lines = [
        "### Summary of Changes",
        f"- **Primary Scope:** `{primary_scope}`",
        f"- **Change Category:** `{primary_type}`",
        f"- **Total Affected Files:** {len(all_files)}",
        "",
        "### Changed Components & Files:"
    ]
    for _, f in staged_files[:20]:
        body_lines.append(f"- `{f}`")
    if len(staged_files) > 20:
        body_lines.append(f"- *...and {len(staged_files) - 20} more files*")

    body_lines.append("\n*Automated pull request generated with structured conventional commit standards.*")

    print(title + "\n\n" + "\n".join(body_lines))

if __name__ == "__main__":
    main()
