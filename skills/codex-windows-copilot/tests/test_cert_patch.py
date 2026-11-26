"""Offline unit tests; no certificate-store, account, GUI or process changes."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/patch-cert-provider.py"
SPEC = importlib.util.spec_from_file_location("cert_patch", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
FIXTURE = (
    b"def example(command):\n"
    b"    return [\n"
    + MODULE.BEFORE + b"\n"
    b"    ]\n"
)


class CertificatePatchTests(unittest.TestCase):
    def setUp(self):
        self.hash_patch = patch.object(
            MODULE, "SOURCE_SHA256", hashlib.sha256(FIXTURE).hexdigest()
        )
        self.hash_patch.start()
        self.addCleanup(self.hash_patch.stop)

    def test_lf_and_crlf_preserve_original_newline_style(self):
        for data in [FIXTURE, FIXTURE.replace(b"\n", b"\r\n")]:
            result, changed = MODULE.patch_bytes(data)
            self.assertTrue(changed)
            self.assertIn(MODULE.AFTER, result.replace(b"\r\n", b"\n"))
            self.assertEqual(b"\r\n" in data, b"\r\n" in result)

    def test_repeated_patch_is_byte_identical(self):
        first, _ = MODULE.patch_bytes(FIXTURE)
        second, changed = MODULE.patch_bytes(first)
        self.assertFalse(changed)
        self.assertEqual(first, second)

    def test_unrelated_source_or_post_patch_change_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.patch_bytes(b"# unrelated change\n" + FIXTURE)
        result, _ = MODULE.patch_bytes(FIXTURE)
        with self.assertRaises(ValueError):
            MODULE.patch_bytes(result + b"# unrelated change\n")

    def test_backup_is_exact_and_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="copilot-cert-patch-test-") as directory:
            root = Path(directory).resolve()
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            target = root / "copilot_app_proxy/cli/windows.py"
            target.parent.mkdir(parents=True)
            target.write_bytes(FIXTURE.replace(b"\n", b"\r\n"))
            original = target.read_bytes()
            self.assertEqual(MODULE.apply(root), "patched_with_backup")
            backup = target.with_name("windows.py.before-cert-provider-fix")
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(MODULE.apply(root), "already_patched")
            target.write_bytes(original)
            with self.assertRaises(FileExistsError):
                MODULE.apply(root)
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(root, Path(directory).resolve())

    def test_relative_runtime_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.apply(Path("relative-app"))


if __name__ == "__main__":
    unittest.main()
