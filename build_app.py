#!/usr/bin/env python3
"""Build School Assistant into a standalone desktop application.

Usage:
    pip install pyinstaller
    python build_app.py

Creates:
    macOS  -> dist/School Assistant.app
    Windows -> dist/SchoolAssistant/SchoolAssistant.exe
"""

import os
import subprocess
import sys

APP_NAME = "School Assistant"
ENTRY = "main.py"
ICON = None  # Set to "assets/icon.icns" (macOS) or "assets/icon.ico" (Windows) if available


def find_customtkinter_path():
    """Locate customtkinter's package directory for bundling its theme data."""
    try:
        import customtkinter
        return os.path.dirname(customtkinter.__file__)
    except ImportError:
        return None


def build():
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--windowed",                       # no console window
        "--name", APP_NAME,
        "--add-data", "core:core",          # bundle app packages
        "--add-data", "gui:gui",
        "--add-data", "utils:utils",
        "--hidden-import", "anthropic",
        "--hidden-import", "PIL",
        "--hidden-import", "pyautogui",
        "--hidden-import", "dotenv",
        "--hidden-import", "tkinter",
    ]

    # Bundle customtkinter theme data if installed
    ctk_path = find_customtkinter_path()
    if ctk_path:
        cmd += ["--add-data", f"{ctk_path}:customtkinter"]
        cmd += ["--hidden-import", "customtkinter"]

    # Add icon if it exists
    if ICON and os.path.isfile(ICON):
        cmd += ["--icon", ICON]

    cmd.append(ENTRY)

    print(f"Building {APP_NAME}...")
    print(f"Command: {' '.join(cmd)}\n")
    subprocess.run(cmd, check=True)

    print(f"\nBuild complete!")
    if sys.platform == "darwin":
        print(f"  App:  dist/{APP_NAME}.app")
        print(f"  Drag it into your Applications folder to install.")
    else:
        print(f"  Exe:  dist/{APP_NAME}/{APP_NAME}.exe")


if __name__ == "__main__":
    build()
