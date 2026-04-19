const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Parse natural language into structured tasks using Groq (Llama 3.3 70B).
 * Same prompt logic as webapp/app/api/tasks/parse/route.ts
 *
 * @param {string} message - Natural language input from user
 * @param {string[]} memberNames - Optional list of team member names for assignee matching
 * @returns {Promise<{ tasks: Array<{ title: string, assignee_hint: string|null }> }>}
 */
async function parseTasks(message, memberNames = []) {
  const memberList = memberNames.join(', ');

  const prompt = `You are an intelligent task extraction assistant. Your job is to understand what the user ACTUALLY means and extract only REAL, actionable tasks from their message.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{ "tasks": [{ "title": string, "assignee_hint": string | null }] }

Rules:
- Extract only REAL tasks that are clearly described. If the user says "three tasks" but only describes two, return only the two real tasks. Never invent or fabricate tasks.
- title: clean, concise task description. Remove filler words like "assign me", "create this task", "I need to" etc. Just the actual task.
- assignee_hint: if a specific person's name is mentioned for that task, use their name. If the user says "assign me" or "for me" or "my tasks", use "me". If no person is specified, use null.
- Think like a smart human assistant — understand intent, fix grammar, ignore noise.
- Support bulk input: comma-separated, numbered lists, or natural language with multiple tasks.
- Available team members: ${memberList || 'none specified'}

Examples:
- "assign me three task create nav text PRD, direct integration mixpanel flow PRD" → 2 tasks (only 2 are described), both assigned to "me"
- "assign John fix login bug, send report to EU bank, create deployment automation" → 3 tasks, all assigned to "John"
- "I need to create a PRD for payments and send data report to manager" → 2 tasks, assignee "me"

Input: ${message}`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 1024,
  });

  const text = chatCompletion.choices[0]?.message?.content || '';

  // Extract JSON from response and sanitize control characters
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Groq response');

  const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ' ';
    return '';
  });
  const parsed = JSON.parse(sanitized);
  if (!parsed.tasks || !Array.isArray(parsed.tasks)) throw new Error('Invalid response shape');

  return parsed;
}

/**
 * Match a user's reply to a numbered list of tasks.
 * Tries regex first for simple patterns like "1 and 3", "1, 2, 3".
 * Falls back to Groq for natural language like "the PRD task and marketing review".
 *
 * @param {string} reply - User's reply text
 * @param {Array<{ index: number, title: string, id: string }>} tasks - Numbered task list
 * @returns {Promise<number[]>} - Array of 1-based indices the user selected
 */
async function matchTasksFromReply(reply, tasks) {
  // Try regex first: extract numbers from patterns like "1 and 3", "1, 2, 3", "first three", etc.
  const numberPattern = /\d+/g;
  const numbers = reply.match(numberPattern);

  if (numbers && numbers.length > 0) {
    const indices = numbers.map(n => parseInt(n)).filter(n => n >= 1 && n <= tasks.length);
    if (indices.length > 0) return indices;
  }

  // Handle "all" keyword
  if (/\ball\b/i.test(reply)) {
    return tasks.map(t => t.index);
  }

  // Fall back to Groq for natural language matching
  const taskList = tasks.map(t => `${t.index}. ${t.title}`).join('\n');

  const prompt = `Given these numbered tasks:
${taskList}

The user replied: "${reply}"

Which task numbers did the user select? Return ONLY valid JSON:
{ "selectedIndices": [1, 3] }

Rules:
- Match by number references ("1 and 3", "first and third")
- Match by description keywords ("the PRD task" → match task with PRD in title)
- Return only numbers that correspond to actual tasks in the list
- If unclear, return empty array`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 256,
  });

  const text = chatCompletion.choices[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ' ';
    return '';
  });
  const parsed = JSON.parse(sanitized);
  const indices = (parsed.selectedIndices || []).filter(n => n >= 1 && n <= tasks.length);
  return indices;
}

/**
 * Format thread messages into a structured string for LLM consumption.
 * Marks the parent message (topic anchor) separately from replies so the
 * model can use it to synthesize self-sufficient task titles.
 * Filters bot messages and resolves user mentions.
 *
 * @param {Array<{user: string, text: string, bot_id?: string}>} messages - Slack thread messages (parent first)
 * @param {Map<string, string>} userMap - Slack user ID → display name
 * @param {string} botUserId - The bot's own Slack user ID (to filter out)
 * @returns {string} Formatted thread text
 */
function formatThreadForLLM(messages, userMap, botUserId) {
  // Filter out bot messages and the bot's own messages
  const humanMessages = messages.filter(m =>
    !m.bot_id && m.user !== botUserId && m.subtype !== 'bot_message'
  );

  if (humanMessages.length === 0) {
    return '=== THREAD PARENT (topic anchor) ===\n(empty)\n\n=== REPLIES (chronological) ===\n(none)';
  }

  // Cap at 50 most recent messages (always keep parent = first message)
  let capped = humanMessages;
  if (humanMessages.length > 50) {
    capped = [humanMessages[0], ...humanMessages.slice(-49)];
  }

  // Resolve <@U123> mentions in text
  const resolveMentions = (text) =>
    (text || '').replace(/<@([A-Z0-9]+)>/g, (_, id) => {
      const name = userMap.get(id);
      return name ? `@${name}` : `@unknown`;
    });

  const fmt = (msg) => {
    const name = userMap.get(msg.user) || 'Unknown';
    let text = resolveMentions(msg.text || '');
    if (text.length > 500) text = text.substring(0, 500) + ' [truncated]';
    return `[${name} (${msg.user})] ${text}`;
  };

  const parent = capped[0];
  const replies = capped.slice(1);

  const lines = [];
  lines.push('=== THREAD PARENT (topic anchor) ===');
  lines.push(fmt(parent));
  lines.push('');
  lines.push('=== REPLIES (chronological) ===');
  if (replies.length === 0) {
    lines.push('(no replies)');
  } else {
    for (const msg of replies) lines.push(fmt(msg));
  }

  return lines.join('\n');
}

/**
 * Extract tasks + assignees from a Slack thread conversation using Groq LLM.
 *
 * The prompt is tuned for two key quality goals:
 *   1. Self-sufficient task titles — a reader seeing only the title (days later,
 *      out of thread context) should understand both WHAT to do and WHAT it's
 *      about. The model is instructed to fold the thread's topic into the title.
 *   2. Per-task assignee inference with an explicit confidence rating, so the
 *      caller can route low-confidence tasks to the requester's Inbox instead
 *      of silently assigning them to the wrong person.
 *
 * @param {string} formattedThread - Structured thread text from formatThreadForLLM
 * @param {string} participantList - "U123 = Alice\nU456 = Bob" mapping
 * @param {{ slackId: string, name: string }} requester - Who tagged the bot
 * @param {string} mentionText - The exact `@Ping …` text the requester wrote (may be empty)
 * @returns {Promise<{
 *   thread_topic: string,
 *   summary: string,
 *   tasks: Array<{
 *     title: string,
 *     assignee_slack_id: string|null,
 *     assignee_name: string|null,
 *     assignee_confidence: 'high'|'medium'|'low',
 *     source_quote: string|null,
 *     due_hint: string|null,
 *   }>
 * }>}
 */
async function extractTasksFromThread(formattedThread, participantList, requester, mentionText) {
  const prompt = `You are a task extraction assistant reading a Slack thread. Your job is to (a) identify the thread's topic, and (b) extract actionable tasks with accurate per-task assignees.

THREAD PARTICIPANTS (Slack ID = Name):
${participantList}

THE REQUESTER (who tagged @Ping): ${requester.name} (${requester.slackId})

=== REQUESTER'S @Ping MENTION TEXT ===
"${(mentionText || '').trim() || '(no extra text — the requester just tagged @Ping)'}"

=== THREAD ===
${formattedThread}

STEP 1 — Identify the thread's topic.
Read the THREAD PARENT (topic anchor) above and any shared context in the replies. Produce a short noun phrase naming what the thread is about — e.g. "Video MF experiment", "signup flow bug", "Q1 roadmap review".

STEP 2 — Extract tasks.
Extract ONLY clearly actionable items (commitments, requests, decisions). Do NOT extract vague discussion, questions, or opinions.

For every task, produce a SELF-SUFFICIENT TITLE. A reader who sees only the title in their task list days later — with zero thread context — must understand BOTH what to do AND what it's about. If the triggering message is missing the subject, fold the thread topic into the title.

BAD vs GOOD TITLE EXAMPLES:
- Thread is about "Video MF experiment". Rediff says "share me detailed insights by Monday".
  ❌ "Share detailed insights by Monday"   (no subject — useless in a todo list)
  ✅ "Share detailed insights on Video MF experiment by Monday"
- Thread is about "signup flow bug". Bob says "I'll fix it tomorrow".
  ❌ "Fix it tomorrow"
  ✅ "Fix the signup flow bug"
- Thread is about "Q1 OKRs doc". Alice says "@Carol can you review and leave comments?"
  ❌ "Review and leave comments"
  ✅ "Review Q1 OKRs doc and leave comments"

Title rules:
- Start with a verb (Share, Fix, Write, Review, Update, Draft, Prepare, Send, Investigate, etc.).
- Include the object/subject (what the task is about) — usually the thread topic or a specific noun from the message.
- Include an explicit deadline if one is mentioned (e.g. "by Monday", "before EOD Friday").
- Do NOT include assignee names in the title. Keep titles ≤140 chars.
- Never invent facts. Use information from the thread and mention text only.

STEP 3 — Assignee detection (per task, not per thread).
For each task decide WHO should own it, and rate how confident you are.

Rules in priority order:
1. If the REQUESTER'S MENTION TEXT contains an explicit directive like "assign to @X", "all to @X", or "to me", that overrides speaker-level inference. Use @X (or the requester for "to me"). Confidence: high.
2. Direct request in-thread — "@Bob can you do X", "Rediff, share the insights" → the named person. Confidence: high.
3. Volunteer — "I'll handle X", "I can take this" → the speaker. Confidence: high.
4. Someone asked the requester directly — "@<requester> please do X" → the requester. Confidence: high.
5. Only one participant could plausibly own it (inferred from context) → that person. Confidence: medium.
6. Otherwise → assignee_slack_id = null, confidence = low. Do NOT guess. Do NOT default to the requester just because you have to pick someone.

For each task also return:
- source_quote: the single message from the thread that triggered this task, verbatim, ≤120 chars (trim with "…" if needed). This is for audit.
- due_hint: any explicit deadline language ("Monday", "EOD Friday", "tomorrow"), or null.

Return ONLY valid JSON (no markdown fences, no prose):
{
  "thread_topic": "short noun phrase",
  "summary": "1-2 sentence summary of the conversation",
  "tasks": [
    {
      "title": "Self-sufficient verb-led title including the subject",
      "assignee_slack_id": "U123 or null",
      "assignee_name": "Display Name or null",
      "assignee_confidence": "high" or "medium" or "low",
      "source_quote": "verbatim message or null",
      "due_hint": "Monday or null"
    }
  ]
}

If no clear tasks exist, return an empty tasks array. Keep task count reasonable (1-8 tasks). Do not over-extract.`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.2,
    max_tokens: 2048,
  });

  const text = chatCompletion.choices[0]?.message?.content || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in thread extraction response');

  const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ' ';
    return '';
  });
  const parsed = JSON.parse(sanitized);
  if (!parsed.tasks || !Array.isArray(parsed.tasks)) throw new Error('Invalid response shape');

  // Normalize each task defensively — older/weaker LLM responses may omit fields.
  const VALID_CONF = new Set(['high', 'medium', 'low']);
  const normalized = parsed.tasks.map(t => ({
    title: String(t.title || '').trim(),
    assignee_slack_id: t.assignee_slack_id || null,
    assignee_name: t.assignee_name || null,
    assignee_confidence: VALID_CONF.has(t.assignee_confidence) ? t.assignee_confidence : 'low',
    source_quote: t.source_quote ? String(t.source_quote).slice(0, 240) : null,
    due_hint: t.due_hint || null,
  })).filter(t => t.title.length > 0);

  return {
    thread_topic: parsed.thread_topic || null,
    summary: parsed.summary || 'Thread analyzed.',
    tasks: normalized,
  };
}

module.exports = { parseTasks, matchTasksFromReply, extractTasksFromThread, formatThreadForLLM };
