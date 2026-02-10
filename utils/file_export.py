"""Export functionality for saving responses."""

import os
import tkinter as tk
from tkinter import filedialog


def copy_to_clipboard(root: tk.Tk, text: str):
    """Copy text to system clipboard."""
    root.clipboard_clear()
    root.clipboard_append(text)


def save_as_txt(text: str, default_name: str = "response.txt") -> str | None:
    """Save text to a .txt file via file dialog. Returns path or None."""
    path = filedialog.asksaveasfilename(
        defaultextension=".txt",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        initialfile=default_name,
    )
    if path:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path
    return None


def export_history_json(history: list[dict], default_name: str = "history.json") -> str | None:
    """Export conversation history as JSON."""
    import json

    path = filedialog.asksaveasfilename(
        defaultextension=".json",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        initialfile=default_name,
    )
    if path:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
        return path
    return None
