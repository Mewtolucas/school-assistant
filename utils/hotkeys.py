"""Keyboard shortcut registration and management."""


# Default hotkey bindings (Tk event format)
DEFAULT_HOTKEYS = {
    "solve": "<Control-Key-1>",
    "summarize": "<Control-Key-2>",
    "tutor": "<Control-Key-3>",
    "save": "<Control-s>",
    "copy": "<Control-c>",
    "region": "<Control-r>",
    "find": "<Control-f>",
}

# Human-readable labels for display
HOTKEY_LABELS = {
    "solve": "Ctrl+1",
    "summarize": "Ctrl+2",
    "tutor": "Ctrl+3",
    "save": "Ctrl+S",
    "copy": "Ctrl+C",
    "region": "Ctrl+R",
    "find": "Ctrl+F",
}


class HotkeyManager:
    """Binds and manages keyboard shortcuts on a Tk root window."""

    def __init__(self, root):
        self._root = root
        self._bindings: dict[str, str] = {}
        self._callbacks: dict[str, callable] = {}

    def register(self, name: str, callback: callable):
        """Register a callback for a named hotkey action."""
        self._callbacks[name] = callback
        binding = DEFAULT_HOTKEYS.get(name)
        if binding:
            self._bindings[name] = binding
            self._root.bind_all(binding, lambda e, cb=callback: cb())

    def unregister(self, name: str):
        """Remove a hotkey binding."""
        binding = self._bindings.pop(name, None)
        if binding:
            self._root.unbind_all(binding)
        self._callbacks.pop(name, None)

    def get_label(self, name: str) -> str:
        """Get human-readable label for a hotkey."""
        return HOTKEY_LABELS.get(name, "")
