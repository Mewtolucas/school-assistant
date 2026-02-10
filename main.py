#!/usr/bin/env python3
"""School Assistant - AI-powered homework helper desktop application.

Launch with:
    python main.py
"""

import os
import sys


def _check_first_run():
    """If no API key is found, show a setup dialog before launching the main window."""
    from utils.config import load_config

    config = load_config()
    if config.get("api_key"):
        return

    # Try loading from .env file in the project directory
    try:
        from dotenv import load_dotenv

        load_dotenv()
        key = os.getenv("ANTHROPIC_API_KEY", "")
        if key:
            config["api_key"] = key
            from utils.config import save_config

            save_config(config)
            return
    except ImportError:
        pass

    # No key found - show first-run dialog
    _show_setup_dialog(config)


def _show_setup_dialog(config: dict):
    """Minimal dialog to collect API key on first launch."""
    import tkinter as tk
    from tkinter import messagebox

    dialog = tk.Tk()
    dialog.title("School Assistant - Setup")
    dialog.geometry("420x220")
    dialog.resizable(False, False)

    tk.Label(
        dialog,
        text="\U0001F393 Welcome to School Assistant!",
        font=("Arial", 14, "bold"),
    ).pack(pady=(18, 6))

    tk.Label(
        dialog,
        text="Enter your Anthropic API key to get started.\n"
        "Get one at console.anthropic.com",
        font=("Arial", 10),
    ).pack(pady=(0, 10))

    key_var = tk.StringVar()
    entry = tk.Entry(dialog, textvariable=key_var, width=44, show="*")
    entry.pack(pady=4)
    entry.focus_set()

    def on_save():
        key = key_var.get().strip()
        if not key:
            messagebox.showwarning("Missing Key", "Please enter an API key.", parent=dialog)
            return
        config["api_key"] = key
        from utils.config import save_config

        save_config(config)
        dialog.destroy()

    def on_skip():
        dialog.destroy()

    btn_frame = tk.Frame(dialog)
    btn_frame.pack(pady=12)
    tk.Button(
        btn_frame, text="Save & Start", width=14, command=on_save, bg="#4A90E2", fg="white"
    ).pack(side="left", padx=6)
    tk.Button(btn_frame, text="Skip for now", width=14, command=on_skip).pack(
        side="left", padx=6
    )

    dialog.mainloop()


def main():
    _check_first_run()

    from gui.window import MainWindow

    app = MainWindow()
    app.run()


if __name__ == "__main__":
    main()
