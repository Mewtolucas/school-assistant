"""Claude API integration with vision capabilities."""

import threading
from typing import Callable

import anthropic

from core.prompts import FOLLOW_UP_SYSTEM


class AIAgent:
    """Manages communication with the Anthropic Claude API."""

    def __init__(self, api_key: str, model: str, temperature: float = 0.3):
        self._client = None
        self._api_key = api_key
        self.model = model
        self.temperature = temperature
        self._conversation: list[dict] = []
        self._max_history = 10  # messages to keep

        if api_key:
            self._init_client()

    def _init_client(self):
        self._client = anthropic.Anthropic(api_key=self._api_key)

    def update_config(self, api_key: str = None, model: str = None, temperature: float = None):
        if api_key is not None and api_key != self._api_key:
            self._api_key = api_key
            self._init_client()
        if model is not None:
            self.model = model
        if temperature is not None:
            self.temperature = temperature

    def clear_conversation(self):
        self._conversation.clear()

    def send_screenshot(
        self,
        image_base64: str,
        prompt: str,
        on_complete: Callable[[str], None],
        on_error: Callable[[str], None],
    ):
        """Send a screenshot with prompt to Claude (runs in background thread)."""

        def _run():
            try:
                if not self._client:
                    on_error("No API key configured. Please add your Anthropic API key in Settings.")
                    return

                message_content = [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_base64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ]

                user_msg = {"role": "user", "content": message_content}

                response = self._client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    temperature=self.temperature,
                    messages=[user_msg],
                )

                result = response.content[0].text

                # Store in conversation history for follow-ups
                self._conversation.append(user_msg)
                self._conversation.append({"role": "assistant", "content": result})
                self._trim_history()

                on_complete(result)

            except anthropic.AuthenticationError:
                on_error("Invalid API key. Please check your Anthropic API key in Settings.")
            except anthropic.RateLimitError:
                on_error("Rate limit reached. Please wait 30 seconds and try again.")
            except anthropic.APIConnectionError:
                on_error("Connection failed. Please check your internet connection.")
            except Exception as e:
                on_error(f"API Error: {str(e)}")

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

    def send_followup(
        self,
        text: str,
        on_complete: Callable[[str], None],
        on_error: Callable[[str], None],
    ):
        """Send a text follow-up using conversation history."""

        def _run():
            try:
                if not self._client:
                    on_error("No API key configured. Please add your Anthropic API key in Settings.")
                    return

                self._conversation.append({"role": "user", "content": text})

                response = self._client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    temperature=self.temperature,
                    system=FOLLOW_UP_SYSTEM,
                    messages=self._conversation,
                )

                result = response.content[0].text
                self._conversation.append({"role": "assistant", "content": result})
                self._trim_history()

                on_complete(result)

            except anthropic.AuthenticationError:
                on_error("Invalid API key. Please check your Anthropic API key in Settings.")
            except anthropic.RateLimitError:
                on_error("Rate limit reached. Please wait 30 seconds and try again.")
            except anthropic.APIConnectionError:
                on_error("Connection failed. Please check your internet connection.")
            except Exception as e:
                on_error(f"API Error: {str(e)}")

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

    def test_connection(self) -> tuple[bool, str]:
        """Test the API connection. Returns (success, message)."""
        try:
            if not self._client:
                return False, "No API key configured."
            self._client.messages.create(
                model=self.model,
                max_tokens=16,
                messages=[{"role": "user", "content": "Hi"}],
            )
            return True, "Connection successful!"
        except anthropic.AuthenticationError:
            return False, "Invalid API key."
        except anthropic.APIConnectionError:
            return False, "Cannot reach API. Check your internet connection."
        except Exception as e:
            return False, f"Error: {str(e)}"

    def _trim_history(self):
        while len(self._conversation) > self._max_history:
            self._conversation.pop(0)
