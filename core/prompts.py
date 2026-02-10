"""Prompt templates for all AI operations."""

SOLVE_DETAILED = """Analyze this screenshot and identify any math, science, or homework problems visible.
Solve each problem completely, showing:
1. Problem statement (rewritten clearly)
2. Step-by-step solution with explanations
3. Final answer highlighted
4. Any relevant formulas or concepts used

Format the response clearly with proper mathematical notation."""

SOLVE_QUICK = """Analyze this screenshot and identify any math, science, or homework problems visible.
Provide brief, direct answers for each problem found. Show minimal work - just the key steps and final answer."""

SOLVE_CHECK_WORK = """Analyze this screenshot which shows a student's work on a problem.
1. Identify what problem they are solving
2. Check each step of their work for correctness
3. If there are errors, explain where they went wrong and show the correct approach
4. If their work is correct, confirm it and note any steps that could be cleaner
5. Give an overall assessment: Correct / Partially Correct / Incorrect"""

SUMMARIZE_BRIEF = """Read and analyze the text visible in this screenshot.
Provide a brief summary:
1. Main Topic (1 line)
2. Key Points (2-3 bullet points)
3. One-sentence summary"""

SUMMARIZE_STANDARD = """Read and analyze the text visible in this screenshot.
Provide:
1. Main Topic/Title (1 line)
2. Key Points (3-5 bullet points)
3. Brief Summary (2-3 sentences)
4. Important terms or concepts to remember

If this appears to be study material, identify what subject/topic it covers."""

SUMMARIZE_DETAILED = """Read and analyze the text visible in this screenshot.
Provide a comprehensive summary:
1. Main Topic/Title
2. Detailed Key Points (5-8 bullet points covering all major ideas)
3. Extended Summary (4-6 sentences)
4. Important terms and definitions
5. Connections to broader concepts
6. Suggested follow-up topics for deeper understanding

If this appears to be study material, identify the subject, topic, and difficulty level."""

KEY_TERMS_ADDON = """

Additionally, extract all key terms and concepts as a flashcard-style list:
- Term: Definition/Explanation
Format each as a clear, concise entry suitable for study review."""

TUTOR = """You are a patient tutor. Look at this problem and:

1. Identify the type of problem and relevant concepts
2. Break down the solution into clear, numbered steps
3. Explain WHY each step is necessary (teach the reasoning)
4. Provide helpful tips or common mistakes to avoid
5. Suggest similar practice problems if possible

Use simple language appropriate for a student learning this concept.
Do not just give the answer - focus on teaching the METHOD."""

TUTOR_STUCK = """The student is stuck on step {step_number} of the previous explanation.
Please:
1. Re-explain that step in simpler terms
2. Provide an analogy or visual way to think about it
3. Show a mini-example that demonstrates just that step
4. Then continue from there"""

TUTOR_SIMILAR_EXAMPLE = """Based on the problem we just discussed, please:
1. Create a similar practice problem (same type, different numbers/values)
2. Provide hints for solving it (without giving the full answer)
3. Then show the complete solution in a collapsible/separate section"""

TUTOR_QUIZ = """Based on the topic we just discussed, create a short quiz:
1. Generate 3-5 practice problems of increasing difficulty
2. For each problem, provide the answer separately at the end
3. Include a mix of problem types if applicable
4. Add brief hints for the harder problems"""

FOLLOW_UP_SYSTEM = """You are a helpful school assistant. You have been helping a student with their work.
Continue the conversation naturally, referencing previous context when relevant.
Keep explanations clear and educational."""


def get_solve_prompt(mode: str = "detailed") -> str:
    prompts = {
        "detailed": SOLVE_DETAILED,
        "quick": SOLVE_QUICK,
        "check": SOLVE_CHECK_WORK,
    }
    return prompts.get(mode, SOLVE_DETAILED)


def get_summary_prompt(length: str = "standard", extract_terms: bool = False) -> str:
    prompts = {
        "brief": SUMMARIZE_BRIEF,
        "standard": SUMMARIZE_STANDARD,
        "detailed": SUMMARIZE_DETAILED,
    }
    prompt = prompts.get(length, SUMMARIZE_STANDARD)
    if extract_terms:
        prompt += KEY_TERMS_ADDON
    return prompt


def get_tutor_prompt() -> str:
    return TUTOR


def get_tutor_followup(action: str, **kwargs) -> str:
    if action == "stuck":
        return TUTOR_STUCK.format(step_number=kwargs.get("step_number", "?"))
    elif action == "similar":
        return TUTOR_SIMILAR_EXAMPLE
    elif action == "quiz":
        return TUTOR_QUIZ
    return ""
