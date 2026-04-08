"""Component file scanner - finds .component.md files under the workspace root."""

from __future__ import annotations

import subprocess
from pathlib import Path


def find_git_root(start: Path) -> Path | None:
    """Find the git repository root starting from the given directory."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(start),
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(result.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def is_gitignored(path: Path, git_root: Path) -> bool:
    """Check if a file is gitignored."""
    try:
        result = subprocess.run(
            ["git", "check-ignore", "-q", str(path)],
            cwd=str(git_root),
            capture_output=True,
        )
        return result.returncode == 0
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def scan_component_files(
    components_root: Path,
    git_root: Path | None = None,
) -> list[Path]:
    """Scan for .component.md files under components_root, excluding gitignored files.

    Returns sorted list of absolute paths.
    """
    if git_root is None:
        git_root = find_git_root(components_root)

    component_files: list[Path] = []
    for path in sorted(components_root.rglob("*.component.md")):
        if not path.is_file():
            continue
        # Resolve and check for symlink escapes
        resolved = path.resolve()
        try:
            resolved.relative_to(components_root.resolve())
        except ValueError:
            continue

        if git_root and is_gitignored(path, git_root):
            continue

        component_files.append(path)

    return component_files


def resolve_component_path(
    link_path: str,
    from_file: Path,
    components_root: Path,
) -> Path | None:
    """Resolve a relative link from a component file to an absolute path.

    Returns None if the resolved path is outside components_root or doesn't exist.
    """
    base_dir = from_file.parent
    resolved = (base_dir / link_path).resolve()

    # Check it's within components_root
    try:
        resolved.relative_to(components_root.resolve())
    except ValueError:
        return None

    if not resolved.is_file():
        return None

    return resolved
