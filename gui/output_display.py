"""Response rendering area with scrolling, formatting, and controls."""

import tkinter as tk

try:
    import customtkinter as ctk
except ImportError:
    ctk = None

from utils.file_export import copy_to_clipboard, save_as_txt

# Font size presets
FONT_SIZES = {"small": 10, "medium": 11, "large": 13}


class OutputDisplay:
    """Scrollable output area for AI responses with navigation and export."""

    def __init__(self, parent, root, theme: str = "light"):
        self._root = root
        self._parent = parent
        self._theme = theme
        self._responses: list[str] = []
        self._current_index = -1
        self._font_size_name = "medium"

        self._build_ui()

    def _build_ui(self):
        bg = "#FFFFFF" if self._theme == "light" else "#1E1E1E"
        fg = "#222222" if self._theme == "light" else "#E0E0E0"
        toolbar_bg = "#F0F0F0" if self._theme == "light" else "#2A2A2A"

        self._frame = tk.Frame(self._parent, bg=bg)
        self._frame.pack(fill="both", expand=True, padx=5, pady=(0, 5))

        # Top toolbar: navigation + actions
        toolbar = tk.Frame(self._frame, bg=toolbar_bg, height=30)
        toolbar.pack(fill="x")

        self._prev_btn = tk.Button(
            toolbar, text="\u25C0", font=("Arial", 9), width=3, relief="flat",
            bg=toolbar_bg, command=self._prev_response,
        )
        self._prev_btn.pack(side="left", padx=2)

        self._counter_label = tk.Label(
            toolbar, text="0/0", font=("Arial", 9), bg=toolbar_bg, fg=fg,
        )
        self._counter_label.pack(side="left", padx=4)

        self._next_btn = tk.Button(
            toolbar, text="\u25B6", font=("Arial", 9), width=3, relief="flat",
            bg=toolbar_bg, command=self._next_response,
        )
        self._next_btn.pack(side="left", padx=2)

        # Right side: copy + save + font size
        self._save_btn = tk.Button(
            toolbar, text="\U0001F4BE", font=("Arial", 10), relief="flat",
            bg=toolbar_bg, command=self._save_response,
        )
        self._save_btn.pack(side="right", padx=2)

        self._copy_btn = tk.Button(
            toolbar, text="\U0001F4CB", font=("Arial", 10), relief="flat",
            bg=toolbar_bg, command=self._copy_response,
        )
        self._copy_btn.pack(side="right", padx=2)

        font_frame = tk.Frame(toolbar, bg=toolbar_bg)
        font_frame.pack(side="right", padx=4)
        for label, name in [("S", "small"), ("M", "medium"), ("L", "large")]:
            btn = tk.Button(
                font_frame, text=label, font=("Arial", 8), width=2, relief="flat",
                bg=toolbar_bg,
                command=lambda n=name: self._set_font_size(n),
            )
            btn.pack(side="left")

        # Text area
        text_frame = tk.Frame(self._frame, bg=bg)
        text_frame.pack(fill="both", expand=True)

        scrollbar = tk.Scrollbar(text_frame)
        scrollbar.pack(side="right", fill="y")

        self._text = tk.Text(
            text_frame,
            wrap="word",
            font=("Consolas", FONT_SIZES["medium"]),
            bg=bg,
            fg=fg,
            insertbackground=fg,
            relief="flat",
            padx=10,
            pady=8,
            state="disabled",
            yscrollcommand=scrollbar.set,
        )
        self._text.pack(fill="both", expand=True)
        scrollbar.config(command=self._text.yview)

        # Configure text tags for basic formatting
        self._text.tag_configure("bold", font=("Consolas", FONT_SIZES["medium"], "bold"))
        self._text.tag_configure("header", font=("Consolas", 13, "bold"), foreground="#4A90E2")
        self._text.tag_configure("answer", font=("Consolas", FONT_SIZES["medium"], "bold"), foreground="#50C878")
        self._text.tag_configure("code", font=("Consolas", FONT_SIZES["medium"]), background="#F0F0F0" if self._theme == "light" else "#333333")

    def show_response(self, text: str):
        """Display a new response and add it to history."""
        self._responses.append(text)
        self._current_index = len(self._responses) - 1
        self._render(text)
        self._update_counter()

    def show_loading(self, message: str = "Analyzing screenshot..."):
        """Show loading state."""
        self._text.config(state="normal")
        self._text.delete("1.0", "end")
        self._text.insert("end", f"\n  {message}\n\n  Please wait...")
        self._text.config(state="disabled")

    def show_error(self, message: str):
        """Show error message."""
        self._text.config(state="normal")
        self._text.delete("1.0", "end")
        self._text.insert("end", f"\n  Error\n\n  {message}")
        self._text.config(state="disabled")

    def clear(self):
        """Clear the display."""
        self._text.config(state="normal")
        self._text.delete("1.0", "end")
        self._text.config(state="disabled")

    def get_current_text(self) -> str:
        """Get current displayed text."""
        if 0 <= self._current_index < len(self._responses):
            return self._responses[self._current_index]
        return ""

    def _render(self, text: str):
        """Render text with basic markdown-like formatting."""
        self._text.config(state="normal")
        self._text.delete("1.0", "end")

        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("###"):
                self._text.insert("end", stripped.lstrip("#").strip() + "\n", "header")
            elif stripped.startswith("##"):
                self._text.insert("end", stripped.lstrip("#").strip() + "\n", "header")
            elif stripped.startswith("#"):
                self._text.insert("end", stripped.lstrip("#").strip() + "\n", "header")
            elif stripped.startswith("**") and stripped.endswith("**"):
                self._text.insert("end", stripped.strip("*") + "\n", "bold")
            elif stripped.startswith("```"):
                self._text.insert("end", stripped.replace("```", "") + "\n", "code")
            elif "final answer" in stripped.lower() or "answer:" in stripped.lower():
                self._text.insert("end", line + "\n", "answer")
            else:
                self._text.insert("end", line + "\n")

        self._text.config(state="disabled")

    def _prev_response(self):
        if self._current_index > 0:
            self._current_index -= 1
            self._render(self._responses[self._current_index])
            self._update_counter()

    def _next_response(self):
        if self._current_index < len(self._responses) - 1:
            self._current_index += 1
            self._render(self._responses[self._current_index])
            self._update_counter()

    def _update_counter(self):
        total = len(self._responses)
        current = self._current_index + 1 if total > 0 else 0
        self._counter_label.config(text=f"{current}/{total}")

    def _set_font_size(self, name: str):
        self._font_size_name = name
        size = FONT_SIZES[name]
        self._text.config(font=("Consolas", size))

    def _copy_response(self):
        text = self.get_current_text()
        if text:
            copy_to_clipboard(self._root, text)

    def _save_response(self):
        text = self.get_current_text()
        if text:
            save_as_txt(text)

    def update_theme(self, theme: str):
        """Switch between light/dark theme."""
        self._theme = theme
        bg = "#FFFFFF" if theme == "light" else "#1E1E1E"
        fg = "#222222" if theme == "light" else "#E0E0E0"
        self._text.config(bg=bg, fg=fg, insertbackground=fg)
        # Re-render current response if any
        if 0 <= self._current_index < len(self._responses):
            self._render(self._responses[self._current_index])
