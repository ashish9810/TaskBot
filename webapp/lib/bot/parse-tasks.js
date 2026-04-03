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
 * Format thread messages into a compact string for LLM consumption.
 * Filters bot messages, resolves user mentions, collapses consecutive same-user messages.
 *
 * @param {Array<{user: string, text: string, bot_id?: string}>} messages - Slack thread messages
 * @param {Map<string, string>} userMap - Slack user ID → display name
 * @param {string} botUserId - The bot's own Slack user ID (to filter out)
 * @returns {string} Formatted thread text
 */
function formatThreadForLLM(messages, userMap, botUserId) {
  // Filter out bot messages and the bot's own messages
  const humanMessages = messages.filter(m =>
    !m.bot_id && m.user !== botUserId && m.subtype !== 'bot_message'
  );

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

  // Build compact format, collapsing consecutive same-user messages
  const lines = [];
  let lastUser = null;
  for (const msg of capped) {
    const name = userMap.get(msg.user) || 'Unknown';
    let text = resolveMentions(msg.text || '');
    // Truncate very long messages
    if (text.length > 500) text = text.substring(0, 500) + ' [truncated]';

    if (msg.user === lastUser) {
      lines.push(text);
    } else {
      lines.push(`[${name}] ${text}`);
      lastUser = msg.user;
    }
  }

  return lines.join('\n');
}

/**
 * Extract tasks + assignees from a Slack thread conversation using Groq LLM.
 *
 * @param {string} formattedThread - Compact thread text from formatThreadForLLM
 * @param {string} participantList - "U123 = Alice, U456 = Bob" mapping
 * @param {{ slackId: string, name: string }} requester - Who tagged the bot
 * @param {string} userMessage - The user's specific request (e.g. "assign tasks from this thread")
 * @returns {Promise<{ tasks: Array<{ title: string, assignee_slack_id: string|null, assignee_name: string|null }>, summary: string }>}
 */
async function extractTasksFromThread(formattedThread, participantList, requester, userMessage) {
  const prompt = `You are a task extraction assistant. A team conversation in Slack is provided below.
Your job is to identify actionable tasks discussed in this conversation and determine who each task should be assigned to.

Thread participants (Slack ID = Name):
${participantList}

The user who asked you to extract tasks: ${requester.name} (${requester.slackId})

Conversation:
${formattedThread}

The user's request: "${userMessage}"

Return ONLY valid JSON (no markdown, no explanation):
{
  "tasks": [
    {
      "title": "concise task description starting with a verb",
      "assignee_slack_id": "SLACK_USER_ID or null",
      "assignee_name": "display name or null"
    }
  ],
  "summary": "1-2 sentence summary of the conversation"
}

Rules:
- Extract ONLY clearly actionable items (commitments, requests, decisions)
- Do NOT extract vague discussion points or questions
- "title": clean, actionable task. Start with a verb (e.g. "Fix", "Write", "Review", "Update")
- "assignee_slack_id": use the exact Slack user ID from the participant list above.
  * If someone says "I'll do X" or "I can handle X", assign to that speaker's Slack ID.
  * If someone says "@Bob can you do X" or "Bob handle X", assign to Bob's Slack ID.
  * If the requester says "assign me" or "assign tasks to me", assign to the requester (${requester.slackId}).
  * If the assignee is unclear, set to null.
- "assignee_name": the display name of the assignee (for readability), or null.
- Keep task count reasonable (1-8 tasks). Don't over-extract.
- If no clear tasks are found, return an empty tasks array.`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 1024,
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

  return {
    tasks: parsed.tasks,
    summary: parsed.summary || 'Thread analyzed.',
  };
}

module.exports = { parseTasks, matchTasksFromReply, extractTasksFromThread, formatThreadForLLM };
