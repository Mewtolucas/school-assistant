"""Screenshot capture logic with full-screen and region selection."""

import base64
import io
import threading
import time

from PIL import Image

try:
    import pyautogui
except Exception:
    pyautogui = None


def capture_full_screen(delay: float = 0, quality: int = 70) -> str | None:
    """Capture full screen after optional delay, return base64-encoded JPEG."""
    if pyautogui is None:
        return None
    if delay > 0:
        time.sleep(delay)
    screenshot = pyautogui.screenshot()
    return _image_to_base64(screenshot, quality)


def capture_region(x: int, y: int, w: int, h: int, quality: int = 70) -> str | None:
    """Capture a specific screen region, return base64-encoded JPEG."""
    if pyautogui is None:
        return None
    screenshot = pyautogui.screenshot(region=(x, y, w, h))
    return _image_to_base64(screenshot, quality)


def _image_to_base64(image: Image.Image, quality: int = 70) -> str:
    """Convert a PIL Image to base64-encoded JPEG string."""
    # Resize if very large to reduce API costs
    max_dim = 2048
    if image.width > max_dim or image.height > max_dim:
        image.thumbnail((max_dim, max_dim), Image.LANCZOS)

    buffer = io.BytesIO()
    image = image.convert("RGB")
    image.save(buffer, format="JPEG", quality=quality)
    return base64.standard_b64encode(buffer.getvalue()).decode("utf-8")


class RegionSelector:
    """Manages region selection with a transparent overlay window."""

    def __init__(self, root, callback):
        self._root = root
        self._callback = callback
        self._overlay = None
        self._canvas = None
        self._start_x = 0
        self._start_y = 0
        self._rect_id = None

    def start(self):
        """Open a fullscreen transparent overlay for region selection."""
        import tkinter as tk

        self._overlay = tk.Toplevel(self._root)
        self._overlay.attributes("-fullscreen", True)
        self._overlay.attributes("-topmost", True)
        self._overlay.attributes("-alpha", 0.3)
        self._overlay.configure(bg="black")
        self._overlay.config(cursor="crosshair")

        self._canvas = tk.Canvas(
            self._overlay, bg="black", highlightthickness=0
        )
        self._canvas.pack(fill="both", expand=True)

        self._canvas.bind("<ButtonPress-1>", self._on_press)
        self._canvas.bind("<B1-Motion>", self._on_drag)
        self._canvas.bind("<ButtonRelease-1>", self._on_release)
        self._overlay.bind("<Escape>", self._cancel)

    def _on_press(self, event):
        self._start_x = event.x
        self._start_y = event.y
        if self._rect_id:
            self._canvas.delete(self._rect_id)
        self._rect_id = self._canvas.create_rectangle(
            self._start_x, self._start_y, self._start_x, self._start_y,
            outline="white", width=2
        )

    def _on_drag(self, event):
        if self._rect_id:
            self._canvas.coords(
                self._rect_id,
                self._start_x, self._start_y, event.x, event.y
            )

    def _on_release(self, event):
        x1 = min(self._start_x, event.x)
        y1 = min(self._start_y, event.y)
        x2 = max(self._start_x, event.x)
        y2 = max(self._start_y, event.y)

        self._overlay.destroy()
        self._overlay = None

        w = x2 - x1
        h = y2 - y1
        if w > 10 and h > 10:
            # Small delay for overlay to close
            self._root.after(200, lambda: self._callback(x1, y1, w, h))

    def _cancel(self, event=None):
        if self._overlay:
            self._overlay.destroy()
            self._overlay = None
