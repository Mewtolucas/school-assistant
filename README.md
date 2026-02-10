# School Assistant

An AI-powered desktop application that helps students solve homework problems, summarize documents, and learn concepts step-by-step. Uses Claude's vision capabilities to analyze screenshots.

## Features

- **Problem Solver** - Screenshot any math, science, or homework problem and get a complete solution with step-by-step work
- **Document Summarizer** - Capture documents or webpages and get concise summaries with key terms
- **Step-by-Step Tutor** - Get educational explanations that teach the method, not just the answer
- **Region Selector** - Select a specific area of the screen instead of capturing everything
- **Follow-up Chat** - Ask clarifying questions about any response
- **Dark/Light Theme** - Toggle between themes for comfortable viewing
- **Always-on-Top** - Floating window stays accessible while you work
- **Keyboard Shortcuts** - Ctrl+1 (Solve), Ctrl+2 (Summarize), Ctrl+3 (Teach Me), Ctrl+R (Region Select)

## Installation

### Prerequisites

- Python 3.10 or newer
- An Anthropic API key ([get one here](https://console.anthropic.com/))

### Setup

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd school-assistant
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Configure your API key (choose one method):

   **Option A** - Environment file:
   ```bash
   cp .env.example .env
   # Edit .env and add your API key
   ```

   **Option B** - The app will prompt you for the key on first launch.

4. Run the application:
   ```bash
   python main.py
   ```

## Usage

### Solving Problems
1. Open your homework or textbook on screen
2. Click **Solve** (or press Ctrl+1)
3. The app captures your screen and sends it to Claude for analysis
4. View the step-by-step solution in the output area

Right-click the Solve button to switch between modes:
- **Detailed work** - Full solution with explanations (default)
- **Quick solve** - Brief answers only
- **Check my work** - Validates your existing solution

### Summarizing Documents
1. Display the document or webpage you want summarized
2. Click **Summarize** (or press Ctrl+2)
3. Get key points, summary, and important terms

Configure summary length in Settings (Brief / Standard / Detailed).

### Learning with the Tutor
1. Display the problem you want to understand
2. Click **Teach Me** (or press Ctrl+3)
3. Get an educational explanation focused on the method
4. Use follow-up buttons: "I'm stuck on a step", "Similar Example", "Quiz Me"

### Region Selection
1. Click **Select Region** (or press Ctrl+R)
2. Draw a rectangle around the specific area you want analyzed
3. Press Escape to cancel

### Follow-up Questions
After any AI response, type a follow-up question in the chat box at the bottom and press Enter.

## Settings

Click the gear icon to configure:
- **API Key** - Your Anthropic API key
- **Model** - Choose between Sonnet (balanced), Opus (most capable), or Haiku (fastest)
- **Temperature** - Creativity control (0.0 = focused, 1.0 = creative)
- **Theme** - Light or dark mode
- **Opacity** - Window transparency (50-100%)
- **Screenshot delay** - 0-5 second delay before capture
- **Screenshot quality** - Low, medium, or high

## Project Structure

```
school_assistant/
├── main.py                 # Application entry point
├── gui/
│   ├── window.py          # Main window layout and lifecycle
│   ├── buttons.py         # Action button handlers
│   ├── output_display.py  # Response rendering area
│   └── settings.py        # Settings dialog
├── core/
│   ├── screenshot.py      # Screen capture and region selection
│   ├── ai_agent.py        # Claude API integration
│   └── prompts.py         # Prompt templates
├── utils/
│   ├── config.py          # Configuration persistence
│   ├── file_export.py     # Export to clipboard/file
│   └── hotkeys.py         # Keyboard shortcut management
├── .env.example            # API key template
└── requirements.txt        # Python dependencies
```

## Troubleshooting

- **"No API key configured"** - Add your key in Settings or in the `.env` file
- **Screenshot fails on Linux** - Install `scrot`: `sudo apt install scrot`
- **Screenshot fails on macOS** - Grant screen recording permission in System Settings > Privacy & Security
- **Window not staying on top** - Some Linux window managers may not support the topmost attribute
- **customtkinter not rendering** - The app falls back to standard tkinter automatically

## License

See [LICENSE](LICENSE) for details.
