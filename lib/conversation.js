const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Understand the user's intent from a natural language message.
 * Returns a structured action the bot should take.
 *
 * @param {string} message - User's message
 * @param {object} taskContext - User's current tasks grouped by status
 * @param {Array|null} recentList - Recently shown numbered task list (for follow-up references)
 * @returns {Promise<object>} - Parsed intent
 */
async function understandIntent(message, taskContext, recentList = null) {
  const contextSummary = `User's current tasks:
- Inbox (${taskContext.backlog.length}): ${taskContext.backlog.map((t, i) => `${i + 1}. ${t.title}`).join(', ') || 'none'}
- To Do (${taskContext.active.length}): ${taskContext.active.map((t, i) => `${i + 1}. ${t.title}`).join(', ') || 'none'}
- In Progress (${taskContext.in_progress.length}): ${taskContext.in_progress.map((t, i) => `${i + 1}. ${t.title}`).join(', ') || 'none'}
- Done (${taskContext.completed.length}): ${taskContext.completed.map((t, i) => `${i + 1}. ${t.title}`).join(', ') || 'none'}`;

  const recentContext = recentList
    ? `\nRecently shown numbered list:\n${recentList.map(t => `${t.index}. ${t.title} (status: ${t.status})`).join('\n')}`
    : '';

  const prompt = `You are a task management AI assistant. Understand what the user wants and return a structured JSON response.

${contextSummary}
${recentContext}

User message: "${message}"

Return ONLY valid JSON (no markdown, no explanation) in this format:
{
  "intent": "create" | "move" | "delete" | "view" | "summary" | "unknown",
  "description": "brief human-readable description of what the user wants",
  "sourceStatus": "backlog" | "active" | "in_progress" | "completed" | null,
  "targetStatus": "backlog" | "active" | "in_progress" | "completed" | null,
  "taskIndices": [1, 3] | null,
  "scope": "all" | "specific" | null,
  "createTasks": [{ "title": "task title" }] | null,
  "needsList": true | false
}

Rules:
- "intent": what action the user wants to perform
  - "create": user wants to create new tasks (extract titles into createTasks array)
  - "move": user wants to move tasks between statuses
  - "delete": user wants to delete tasks
  - "view": user wants to see their tasks in a specific status
  - "summary": user wants an overview of all tasks
  - "unknown": can't understand the request
- "sourceStatus": where the tasks currently are. Map user language:
  - "inbox" / "backlog" → "backlog"
  - "to do" / "todo" / "to-do" → "active"
  - "in progress" / "in-progress" / "working on" → "in_progress"
  - "done" / "complete" / "completed" / "finished" → "completed"
- "targetStatus": where to move them. Same mapping as above.
  - For "move to in progress" → targetStatus = "in_progress"
  - For "mark as done" / "complete" → targetStatus = "completed"
  - For "move to todo" → targetStatus = "active"
- "taskIndices": if the user references specific task numbers AND a recent list was shown, include the numbers. Otherwise null.
- "scope": "all" if user says "all my tasks" / "delete everything", "specific" if they reference specific tasks, null otherwise
- "needsList": true if we need to show the user a list of tasks before they can pick. Set to true when:
  - User says "move task" but we don't know which one
  - User wants to view tasks
  - User wants to delete but hasn't specified which
  Set to false when:
  - User is creating tasks (we have the titles)
  - User gave specific numbers AND a recent list exists
  - User wants a summary
- "createTasks": only for "create" intent. Extract clean task titles.

Examples:
- "show me my in progress tasks" → { intent: "view", sourceStatus: "in_progress", needsList: true }
- "move task 1 and 3 to done" (with recent list) → { intent: "move", taskIndices: [1, 3], targetStatus: "completed", needsList: false }
- "move my task to in progress" (no recent list) → { intent: "move", targetStatus: "in_progress", sourceStatus: "active", needsList: true }
- "delete all my to-do tasks" → { intent: "delete", sourceStatus: "active", scope: "all", needsList: true }
- "create PRD for payments and send report" → { intent: "create", createTasks: [{ title: "Create PRD for payments" }, { title: "Send report" }], needsList: false }
- "what's on my plate" → { intent: "summary", needsList: false }
- "asdjkashd" → { intent: "unknown", needsList: false }
- "mark task 1, 3, 4 as done" (no recent list) → { intent: "move", targetStatus: "completed", sourceStatus: "in_progress", needsList: true }`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 512,
  });

  const text = chatCompletion.choices[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { intent: 'unknown', needsList: false };

  try {
    const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\t') return ' ';
      return '';
    });
    return JSON.parse(sanitized);
  } catch {
    return { intent: 'unknown', needsList: false };
  }
}

/**
 * Build a numbered task list message for a given status.
 */
function buildTaskListMessage(tasks, statusLabel) {
  if (tasks.length === 0) {
    return { text: `You have no tasks in *${statusLabel}*.`, numberedTasks: [] };
  }

  const numberedTasks = tasks.map((t, i) => ({
    index: i + 1,
    id: t.id,
    title: t.title,
    status: t.status,
  }));

  const listText = numberedTasks.map(t => `${t.index}. ${t.title}`).join('\n');
  const text = `You have *${tasks.length} task(s)* in *${statusLabel}*:\n\n${listText}`;

  return { text, numberedTasks };
}

/**
 * Build a summary message showing task counts.
 */
function buildSummaryMessage(taskContext) {
  const lines = [
    `:inbox_tray: *Inbox:* ${taskContext.backlog.length} task(s)`,
    `:clipboard: *To Do:* ${taskContext.active.length} task(s)`,
    `:arrows_counterclockwise: *In Progress:* ${taskContext.in_progress.length} task(s)`,
    `:white_check_mark: *Done:* ${taskContext.completed.length} task(s)`,
  ];

  const total = taskContext.backlog.length + taskContext.active.length +
    taskContext.in_progress.length + taskContext.completed.length;

  return `:bar_chart: *Your Task Summary* (${total} total)\n\n${lines.join('\n')}`;
}

const STATUS_LABELS = {
  backlog: 'Inbox',
  active: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
};

const UNKNOWN_RESPONSE = `:thinking_face: I didn't quite understand that. Here are some things I can help with:

• *"Show my tasks"* — view all your tasks
• *"Show my in-progress tasks"* — view tasks by status
• *"Create PRD for payments, send report"* — create new tasks
• *"Move my tasks to in progress"* — change task status
• *"Mark task 1, 3 as done"* — complete tasks
• *"Delete task 2"* — remove a task
• *"What's on my plate?"* — get a task summary`;

module.exports = {
  understandIntent,
  buildTaskListMessage,
  buildSummaryMessage,
  STATUS_LABELS,
  UNKNOWN_RESPONSE,
};
