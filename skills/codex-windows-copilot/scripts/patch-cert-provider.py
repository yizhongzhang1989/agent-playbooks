"""Fix the pinned App launcher's Windows PowerShell certificate-provider check.

Only edits a reviewed private runtime copy, retaining exact original backup bytes.
No certificates, processes or credentials are changed by this script.
"""

import argparse
import hashlib
from pathlib import Path
import uuid

SOURCE_SHA256 = "5272b0d1c0ab4c3feec8430ff17d6eb516cd647d3fe9d5e17de43cc662f92631"
BEFORE = b'            "$ErrorActionPreference = \'Stop\'; " + command,'
AFTER = (
    b'            "$ErrorActionPreference = \'Stop\'; "\n'
    b'            "Import-Module (Join-Path $PSHOME '
    b"'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') "
    b'-ErrorAction Stop; " + command,'
)


def patch_bytes(data):
    normalized = data.replace(b"\r\n", b"\n")
    if AFTER in normalized:
        original = normalized.replace(AFTER, BEFORE, 1)
        if hashlib.sha256(original).hexdigest() == SOURCE_SHA256:
            return data, False
        raise ValueError("Patched source has unrelated changes.")
    if hashlib.sha256(normalized).hexdigest() != SOURCE_SHA256:
        raise ValueError("Source differs from the pinned reviewed revision.")
    if normalized.count(BEFORE) != 1:
        raise ValueError("Patch context is not unique.")
    patched = normalized.replace(BEFORE, AFTER, 1)
    if b"\r\n" in data:
        if b"\n" in data.replace(b"\r\n", b""):
            raise ValueError("Mixed newlines require manual review.")
        patched = patched.replace(b"\n", b"\r\n")
    compile(patched, "windows.py", "exec")
    return patched, True


def apply(root):
    if not root.is_absolute():
        raise ValueError("Use an absolute private runtime root.")
    root = root.resolve(strict=True)
    target = root / "copilot_app_proxy/cli/windows.py"
    if target.is_symlink() or not target.resolve(strict=True).is_relative_to(root):
        raise ValueError("Target escaped the runtime.")
    original = target.read_bytes()
    patched, changed = patch_bytes(original)
    if not changed:
        return "already_patched"
    backup = target.with_name("windows.py.before-cert-provider-fix")
    with backup.open("xb") as stream:
        stream.write(original)
    temporary = target.with_name(f"windows.py.{uuid.uuid4().hex}.tmp")
    with temporary.open("xb") as stream:
        stream.write(patched)
    if target.read_bytes() != original:
        raise ValueError("Source changed during patch; private backup and temp retained.")
    temporary.replace(target)
    return "patched_with_backup"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(apply(args.app_root))
    except (OSError, ValueError, SyntaxError) as error:
        parser.exit(1, f"Certificate-provider patch stopped: {error}\n")
