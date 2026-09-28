"""CUDA and NVIDIA DLL initialization for Windows."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def setup_cuda_dll_paths() -> None:
    """Ensure NVIDIA CUDA/cuDNN DLL directories are registered on Windows."""
    if sys.platform != "win32":
        return

    try:
        candidate_dirs: list[Path] = []
        site_packages = Path(sys.prefix) / "Lib" / "site-packages"
        nvidia_root = site_packages / "nvidia"
        if nvidia_root.is_dir():
            for bin_dir in nvidia_root.glob("*/bin"):
                if bin_dir.is_dir():
                    candidate_dirs.append(bin_dir)

        cuda_path = os.environ.get("CUDA_PATH")
        if cuda_path:
            cuda_bin = Path(cuda_path) / "bin"
            if cuda_bin.is_dir():
                candidate_dirs.append(cuda_bin)

        for d in candidate_dirs:
            try:
                os.add_dll_directory(str(d))
            except (FileNotFoundError, OSError):
                pass
            d_str = str(d)
            if d_str not in os.environ.get("PATH", ""):
                os.environ["PATH"] = d_str + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


# Run automatically on module import on Windows
setup_cuda_dll_paths()
