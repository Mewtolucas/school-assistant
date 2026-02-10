"""Settings panel - API key, model, appearance, screenshots."""

import tkinter as tk
from tkinter import messagebox

from utils.config import MODEL_CHOICES, save_config


class SettingsPanel:
    """Modal settings dialog."""

    def __init__(self, parent, config: dict, on_save: callable, ai_agent=None):
        self._config = config
        self._on_save = on_save
        self._ai_agent = ai_agent

        self._win = tk.Toplevel(parent)
        self._win.title("Settings")
        self._win.geometry("400x520")
        self._win.resizable(False, False)
        self._win.transient(parent)
        self._win.grab_set()

        self._build_ui()

    def _build_ui(self):
        canvas = tk.Canvas(self._win)
        scrollbar = tk.Scrollbar(self._win, command=canvas.yview)
        frame = tk.Frame(canvas)

        frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        pad = {"padx": 15, "pady": 4, "sticky": "w"}

        # --- API Configuration ---
        tk.Label(frame, text="API Configuration", font=("Arial", 12, "bold")).grid(
            row=0, column=0, columnspan=2, **{**pad, "pady": (12, 4)}
        )

        tk.Label(frame, text="API Key:").grid(row=1, column=0, **pad)
        self._api_key_var = tk.StringVar(value=self._config.get("api_key", ""))
        api_entry = tk.Entry(frame, textvariable=self._api_key_var, width=35, show="*")
        api_entry.grid(row=1, column=1, padx=5, pady=4)

        tk.Label(frame, text="Model:").grid(row=2, column=0, **pad)
        self._model_var = tk.StringVar()
        current_model = self._config.get("model", "")
        # Find display name for current model
        for display, value in MODEL_CHOICES.items():
            if value == current_model:
                self._model_var.set(display)
                break
        else:
            self._model_var.set(list(MODEL_CHOICES.keys())[0])

        model_menu = tk.OptionMenu(frame, self._model_var, *MODEL_CHOICES.keys())
        model_menu.config(width=28)
        model_menu.grid(row=2, column=1, padx=5, pady=4)

        tk.Label(frame, text="Temperature:").grid(row=3, column=0, **pad)
        self._temp_var = tk.DoubleVar(value=self._config.get("temperature", 0.3))
        temp_scale = tk.Scale(
            frame, from_=0.0, to=1.0, resolution=0.1,
            orient="horizontal", variable=self._temp_var, length=200,
        )
        temp_scale.grid(row=3, column=1, padx=5, pady=4)

        test_btn = tk.Button(frame, text="Test Connection", command=self._test_connection)
        test_btn.grid(row=4, column=0, columnspan=2, pady=6)

        # --- Appearance ---
        tk.Label(frame, text="Appearance", font=("Arial", 12, "bold")).grid(
            row=5, column=0, columnspan=2, **{**pad, "pady": (12, 4)}
        )

        tk.Label(frame, text="Theme:").grid(row=6, column=0, **pad)
        self._theme_var = tk.StringVar(value=self._config.get("appearance", {}).get("theme", "light"))
        tk.OptionMenu(frame, self._theme_var, "light", "dark").grid(row=6, column=1, padx=5, pady=4, sticky="w")

        tk.Label(frame, text="Opacity:").grid(row=7, column=0, **pad)
        self._opacity_var = tk.DoubleVar(value=self._config.get("appearance", {}).get("opacity", 1.0))
        tk.Scale(
            frame, from_=0.5, to=1.0, resolution=0.05,
            orient="horizontal", variable=self._opacity_var, length=200,
        ).grid(row=7, column=1, padx=5, pady=4)

        tk.Label(frame, text="Font Size:").grid(row=8, column=0, **pad)
        self._font_var = tk.StringVar(value=self._config.get("appearance", {}).get("font_size", "medium"))
        tk.OptionMenu(frame, self._font_var, "small", "medium", "large").grid(
            row=8, column=1, padx=5, pady=4, sticky="w"
        )

        # --- Screenshot ---
        tk.Label(frame, text="Screenshot", font=("Arial", 12, "bold")).grid(
            row=9, column=0, columnspan=2, **{**pad, "pady": (12, 4)}
        )

        tk.Label(frame, text="Delay (sec):").grid(row=10, column=0, **pad)
        self._delay_var = tk.IntVar(value=self._config.get("screenshot", {}).get("delay", 0))
        tk.Scale(
            frame, from_=0, to=5, orient="horizontal",
            variable=self._delay_var, length=200,
        ).grid(row=10, column=1, padx=5, pady=4)

        tk.Label(frame, text="Quality:").grid(row=11, column=0, **pad)
        self._quality_var = tk.StringVar(value=self._config.get("screenshot", {}).get("quality", "medium"))
        tk.OptionMenu(frame, self._quality_var, "low", "medium", "high").grid(
            row=11, column=1, padx=5, pady=4, sticky="w"
        )

        # --- Privacy ---
        tk.Label(frame, text="Privacy", font=("Arial", 12, "bold")).grid(
            row=12, column=0, columnspan=2, **{**pad, "pady": (12, 4)}
        )

        self._save_history_var = tk.BooleanVar(
            value=self._config.get("privacy", {}).get("save_history", True)
        )
        tk.Checkbutton(frame, text="Save response history", variable=self._save_history_var).grid(
            row=13, column=0, columnspan=2, **pad
        )

        # --- Buttons ---
        btn_frame = tk.Frame(frame)
        btn_frame.grid(row=14, column=0, columnspan=2, pady=15)

        tk.Button(btn_frame, text="Save", width=12, command=self._save, bg="#4A90E2", fg="white").pack(
            side="left", padx=8
        )
        tk.Button(btn_frame, text="Cancel", width=12, command=self._win.destroy).pack(
            side="left", padx=8
        )

    def _test_connection(self):
        if self._ai_agent is None:
            messagebox.showinfo("Test", "AI agent not initialized.", parent=self._win)
            return
        key = self._api_key_var.get().strip()
        model = MODEL_CHOICES.get(self._model_var.get(), self._config.get("model", ""))
        self._ai_agent.update_config(api_key=key, model=model)
        ok, msg = self._ai_agent.test_connection()
        if ok:
            messagebox.showinfo("Connection Test", msg, parent=self._win)
        else:
            messagebox.showerror("Connection Test", msg, parent=self._win)

    def _save(self):
        self._config["api_key"] = self._api_key_var.get().strip()
        self._config["model"] = MODEL_CHOICES.get(self._model_var.get(), self._config.get("model"))
        self._config["temperature"] = self._temp_var.get()
        self._config["appearance"]["theme"] = self._theme_var.get()
        self._config["appearance"]["opacity"] = self._opacity_var.get()
        self._config["appearance"]["font_size"] = self._font_var.get()
        self._config["screenshot"]["delay"] = self._delay_var.get()
        self._config["screenshot"]["quality"] = self._quality_var.get()
        self._config["privacy"]["save_history"] = self._save_history_var.get()

        save_config(self._config)
        self._on_save(self._config)
        self._win.destroy()
