"""Main application window - layout, theming, chat input, and lifecycle."""

import tkinter as tk

try:
    import customtkinter as ctk
    HAS_CTK = True
except ImportError:
    ctk = None
    HAS_CTK = False

from core.ai_agent import AIAgent
from core.prompts import get_tutor_followup
from gui.buttons import ActionButtons
from gui.output_display import OutputDisplay
from gui.settings import SettingsPanel
from utils.config import load_config, save_config, QUALITY_MAP
from utils.hotkeys import HotkeyManager, HOTKEY_LABELS
from utils.file_export import copy_to_clipboard


class MainWindow:
    """Top-level window for the School Assistant application."""

    def __init__(self):
        self._config = load_config()
        self._build_root()
        self._ai = AIAgent(
            api_key=self._config.get("api_key", ""),
            model=self._config.get("model", "claude-sonnet-4-5-20250514"),
            temperature=self._config.get("temperature", 0.3),
        )
        self._build_ui()
        self._setup_hotkeys()
        self._apply_config()

    # ------------------------------------------------------------------
    # Window setup
    # ------------------------------------------------------------------

    def _build_root(self):
        if HAS_CTK:
            theme = self._config.get("appearance", {}).get("theme", "light")
            ctk.set_appearance_mode("dark" if theme == "dark" else "light")
            ctk.set_default_color_theme("blue")

        self._root = tk.Tk()
        self._root.title("School Assistant")
        self._root.geometry(self._geometry_string())
        self._root.minsize(300, 400)
        self._root.attributes("-topmost", True)
        self._root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Try to set transparency
        try:
            opacity = self._config.get("appearance", {}).get("opacity", 1.0)
            self._root.attributes("-alpha", opacity)
        except tk.TclError:
            pass

    def _geometry_string(self) -> str:
        w = self._config.get("window", {})
        return f"{w.get('width', 350)}x{w.get('height', 600)}+{w.get('x', 100)}+{w.get('y', 100)}"

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self):
        theme = self._config.get("appearance", {}).get("theme", "light")
        bg = "#F5F5F5" if theme == "light" else "#1A1A1A"
        fg = "#222222" if theme == "light" else "#E0E0E0"

        self._root.configure(bg=bg)

        # Title bar area
        title_frame = tk.Frame(self._root, bg="#4A90E2", height=38)
        title_frame.pack(fill="x")
        title_frame.pack_propagate(False)

        tk.Label(
            title_frame, text="\U0001F393 School Assistant",
            font=("Arial", 13, "bold"), bg="#4A90E2", fg="white",
        ).pack(side="left", padx=10)

        settings_btn = tk.Button(
            title_frame, text="\u2699", font=("Arial", 14), bg="#4A90E2", fg="white",
            relief="flat", cursor="hand2", command=self._open_settings,
        )
        settings_btn.pack(side="right", padx=8)

        theme_btn = tk.Button(
            title_frame, text="\U0001F319" if theme == "light" else "\u2600",
            font=("Arial", 12), bg="#4A90E2", fg="white",
            relief="flat", cursor="hand2", command=self._toggle_theme,
        )
        theme_btn.pack(side="right")
        self._theme_btn = theme_btn

        # Notification area (hidden by default)
        self._notif_label = tk.Label(
            self._root, text="", font=("Arial", 10), bg="#50C878", fg="white",
            height=0, anchor="w", padx=10,
        )

        # Output display
        self._output = OutputDisplay(self._root, self._root, theme)

        # Action buttons
        self._buttons = ActionButtons(
            self._root, self._config, self._ai, self._output, self._root
        )

        # Chat / follow-up input
        chat_frame = tk.Frame(self._root, bg=bg)
        chat_frame.pack(fill="x", padx=5, pady=(0, 5))

        self._chat_entry = tk.Entry(
            chat_frame, font=("Arial", 11), relief="solid", bd=1,
        )
        self._chat_entry.pack(side="left", fill="x", expand=True, ipady=4)
        self._chat_entry.insert(0, "Ask a follow-up...")
        self._chat_entry.bind("<FocusIn>", self._on_chat_focus_in)
        self._chat_entry.bind("<FocusOut>", self._on_chat_focus_out)
        self._chat_entry.bind("<Return>", self._on_chat_send)

        send_btn = tk.Button(
            chat_frame, text="\u27A4", font=("Arial", 12),
            bg="#4A90E2", fg="white", relief="flat", cursor="hand2",
            command=lambda: self._on_chat_send(None),
        )
        send_btn.pack(side="right", padx=(4, 0))

        # Tutor quick-action buttons (hidden until tutor mode used)
        tutor_frame = tk.Frame(self._root, bg=bg)
        tutor_frame.pack(fill="x", padx=5, pady=(0, 5))

        btn_cfg = {"font": ("Arial", 9), "relief": "flat", "cursor": "hand2", "bg": "#E8E8E8"}
        tk.Button(
            tutor_frame, text="I'm stuck on a step...", command=self._on_stuck, **btn_cfg,
        ).pack(side="left", padx=(0, 3))
        tk.Button(
            tutor_frame, text="Similar Example", command=self._on_similar, **btn_cfg,
        ).pack(side="left", padx=3)
        tk.Button(
            tutor_frame, text="Quiz Me", command=self._on_quiz, **btn_cfg,
        ).pack(side="left", padx=3)

        # Status bar
        self._status = tk.Label(
            self._root, text="Ready", font=("Arial", 9), bg=bg, fg="#888888", anchor="w",
        )
        self._status.pack(fill="x", padx=8, pady=(0, 3))

    # ------------------------------------------------------------------
    # Chat / follow-up
    # ------------------------------------------------------------------

    def _on_chat_focus_in(self, event):
        if self._chat_entry.get() == "Ask a follow-up...":
            self._chat_entry.delete(0, "end")

    def _on_chat_focus_out(self, event):
        if not self._chat_entry.get().strip():
            self._chat_entry.insert(0, "Ask a follow-up...")

    def _on_chat_send(self, event):
        text = self._chat_entry.get().strip()
        if not text or text == "Ask a follow-up...":
            return
        self._chat_entry.delete(0, "end")
        self._output.show_loading("Thinking...")
        self._ai.send_followup(
            text,
            on_complete=lambda r: self._root.after(0, self._output.show_response, r),
            on_error=lambda e: self._root.after(0, self._output.show_error, e),
        )

    # ------------------------------------------------------------------
    # Tutor quick actions
    # ------------------------------------------------------------------

    def _on_stuck(self):
        prompt = get_tutor_followup("stuck", step_number="the mentioned")
        self._output.show_loading("Re-explaining...")
        self._ai.send_followup(
            prompt,
            on_complete=lambda r: self._root.after(0, self._output.show_response, r),
            on_error=lambda e: self._root.after(0, self._output.show_error, e),
        )

    def _on_similar(self):
        prompt = get_tutor_followup("similar")
        self._output.show_loading("Creating similar example...")
        self._ai.send_followup(
            prompt,
            on_complete=lambda r: self._root.after(0, self._output.show_response, r),
            on_error=lambda e: self._root.after(0, self._output.show_error, e),
        )

    def _on_quiz(self):
        prompt = get_tutor_followup("quiz")
        self._output.show_loading("Generating quiz...")
        self._ai.send_followup(
            prompt,
            on_complete=lambda r: self._root.after(0, self._output.show_response, r),
            on_error=lambda e: self._root.after(0, self._output.show_error, e),
        )

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def _open_settings(self):
        SettingsPanel(self._root, self._config, self._on_settings_saved, self._ai)

    def _on_settings_saved(self, new_config: dict):
        self._config = new_config
        self._ai.update_config(
            api_key=new_config.get("api_key"),
            model=new_config.get("model"),
            temperature=new_config.get("temperature"),
        )
        self._apply_config()
        self._buttons.update_config(new_config)

    def _apply_config(self):
        appearance = self._config.get("appearance", {})
        try:
            self._root.attributes("-alpha", appearance.get("opacity", 1.0))
        except tk.TclError:
            pass
        theme = appearance.get("theme", "light")
        self._output.update_theme(theme)

    # ------------------------------------------------------------------
    # Theme toggle
    # ------------------------------------------------------------------

    def _toggle_theme(self):
        current = self._config.get("appearance", {}).get("theme", "light")
        new_theme = "dark" if current == "light" else "light"
        self._config["appearance"]["theme"] = new_theme

        bg = "#F5F5F5" if new_theme == "light" else "#1A1A1A"
        self._root.configure(bg=bg)
        self._output.update_theme(new_theme)
        self._theme_btn.config(text="\U0001F319" if new_theme == "light" else "\u2600")
        self._status.config(bg=bg)

        if HAS_CTK:
            ctk.set_appearance_mode("dark" if new_theme == "dark" else "light")

        save_config(self._config)

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------

    def _show_notification(self, message: str, duration_ms: int = 2000):
        self._notif_label.config(text=f"  {message}", height=1)
        self._notif_label.pack(fill="x", before=self._output._frame)
        self._root.after(duration_ms, self._hide_notification)

    def _hide_notification(self):
        self._notif_label.pack_forget()

    # ------------------------------------------------------------------
    # Hotkeys
    # ------------------------------------------------------------------

    def _setup_hotkeys(self):
        self._hk = HotkeyManager(self._root)
        self._hk.register("solve", self._buttons._on_solve)
        self._hk.register("summarize", self._buttons._on_summarize)
        self._hk.register("tutor", self._buttons._on_tutor)
        self._hk.register("save", lambda: self._output._save_response())
        self._hk.register("region", self._buttons._on_region_select)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def _on_close(self):
        """Save window geometry and exit."""
        try:
            geo = self._root.geometry()
            # Format: WxH+X+Y
            size, pos = geo.split("+", 1)
            w, h = size.split("x")
            x, y = pos.split("+")
            self._config["window"] = {
                "width": int(w), "height": int(h),
                "x": int(x), "y": int(y),
            }
            save_config(self._config)
        except Exception:
            pass
        self._root.destroy()

    def run(self):
        """Start the main event loop."""
        self._root.mainloop()
