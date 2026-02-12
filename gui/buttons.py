"""Button handlers for main actions - solve, summarize, tutor, region select."""

import tkinter as tk

from core.prompts import get_solve_prompt, get_summary_prompt, get_tutor_prompt
from core.screenshot import capture_full_screen, RegionSelector
from utils.config import QUALITY_MAP


class ActionButtons:
    """Creates and manages the main action button bar."""

    def __init__(self, parent, config: dict, ai_agent, output_display, root):
        self._parent = parent
        self._config = config
        self._ai = ai_agent
        self._output = output_display
        self._root = root
        self._region_selector = None
        self._solve_mode = "detailed"

        self._build_ui()

    def _build_ui(self):
        frame = tk.Frame(self._parent, bg=self._parent["bg"])
        frame.pack(fill="x", padx=5, pady=5)

        btn_style = {
            "font": ("Arial", 11),
            "relief": "flat",
            "cursor": "hand2",
            "height": 1,
        }

        # Row 1: main action buttons
        row1 = tk.Frame(frame, bg=frame["bg"])
        row1.pack(fill="x", pady=(0, 3))

        self._solve_btn = tk.Button(
            row1, text="\U0001F4DD Solve", bg="#4A90E2", fg="white",
            command=self._on_solve, **btn_style,
        )
        self._solve_btn.pack(side="left", fill="x", expand=True, padx=(0, 2))
        self._solve_btn.bind("<Button-3>", self._solve_context_menu)

        self._summary_btn = tk.Button(
            row1, text="\U0001F4C4 Summarize", bg="#5B9BD5", fg="white",
            command=self._on_summarize, **btn_style,
        )
        self._summary_btn.pack(side="left", fill="x", expand=True, padx=2)

        self._tutor_btn = tk.Button(
            row1, text="\U0001F393 Teach Me", bg="#6BA5DE", fg="white",
            command=self._on_tutor, **btn_style,
        )
        self._tutor_btn.pack(side="left", fill="x", expand=True, padx=(2, 0))

        # Row 2: secondary actions
        row2 = tk.Frame(frame, bg=frame["bg"])
        row2.pack(fill="x")

        self._region_btn = tk.Button(
            row2, text="\U0001F4D0 Select Region", bg="#7BB3E7", fg="white",
            command=self._on_region_select, **btn_style,
        )
        self._region_btn.pack(side="left", fill="x", expand=True, padx=(0, 2))

        self._new_topic_btn = tk.Button(
            row2, text="\U0001F504 New Topic", bg="#A0A0A0", fg="white",
            command=self._on_new_topic, **btn_style,
        )
        self._new_topic_btn.pack(side="left", fill="x", expand=True, padx=(2, 0))

    # --- Solve ---

    def _on_solve(self):
        self._capture_and_send(get_solve_prompt(self._solve_mode))

    def _solve_context_menu(self, event):
        menu = tk.Menu(self._root, tearoff=0)
        menu.add_command(label="Solve with detailed work", command=lambda: self._set_solve_mode("detailed"))
        menu.add_command(label="Solve quickly", command=lambda: self._set_solve_mode("quick"))
        menu.add_command(label="Check my work", command=lambda: self._set_solve_mode("check"))
        menu.tk_popup(event.x_root, event.y_root)

    def _set_solve_mode(self, mode: str):
        self._solve_mode = mode
        labels = {"detailed": "\U0001F4DD Solve", "quick": "\U0001F4DD Quick Solve", "check": "\U0001F4DD Check Work"}
        self._solve_btn.config(text=labels.get(mode, labels["detailed"]))

    # --- Summarize ---

    def _on_summarize(self):
        length = self._config.get("summary_length", "standard")
        extract = self._config.get("extract_key_terms", False)
        prompt = get_summary_prompt(length, extract)
        self._capture_and_send(prompt)

    # --- Tutor ---

    def _on_tutor(self):
        self._capture_and_send(get_tutor_prompt())

    # --- Region select ---

    def _on_region_select(self):
        # Minimize main window briefly
        self._root.withdraw()
        self._root.after(300, self._start_region)

    def _start_region(self):
        self._region_selector = RegionSelector(self._root, self._on_region_captured)
        self._region_selector.start()

    def _on_region_captured(self, x, y, w, h):
        self._root.deiconify()
        quality = QUALITY_MAP.get(self._config.get("screenshot", {}).get("quality", "medium"), 70)
        from core.screenshot import capture_region
        img_b64 = capture_region(x, y, w, h, quality)
        if img_b64 is None:
            self._output.show_error("Screenshot failed. pyautogui may not be available.")
            return
        self._output.show_loading()
        self._ai.send_screenshot(
            img_b64,
            get_solve_prompt(self._solve_mode),
            on_complete=lambda r: self._root.after(0, self._output.show_response, r),
            on_error=lambda e: self._root.after(0, self._output.show_error, e),
        )

    # --- New topic ---

    def _on_new_topic(self):
        self._ai.clear_conversation()
        self._output.clear()

    # --- Shared capture logic ---

    def _capture_and_send(self, prompt: str):
        delay = self._config.get("screenshot", {}).get("delay", 0)
        quality = QUALITY_MAP.get(self._config.get("screenshot", {}).get("quality", "medium"), 70)

        # Hide the window so it doesn't appear in the screenshot
        self._root.withdraw()

        def _do_capture():
            import time
            # Wait for the window to fully disappear from screen
            time.sleep(0.3)

            img_b64 = capture_full_screen(delay=delay, quality=quality)

            # Re-show the window
            self._root.after(0, self._root.deiconify)

            if img_b64 is None:
                self._root.after(0, self._output.show_error,
                                 "Screenshot failed. pyautogui may not be available on this system.")
                return
            self._root.after(0, self._output.show_loading, "Analyzing screenshot...")
            self._ai.send_screenshot(
                img_b64,
                prompt,
                on_complete=lambda r: self._root.after(0, self._output.show_response, r),
                on_error=lambda e: self._root.after(0, self._output.show_error, e),
            )

        import threading
        threading.Thread(target=_do_capture, daemon=True).start()

    def update_config(self, config: dict):
        self._config = config
