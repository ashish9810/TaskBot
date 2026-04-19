// Shared LLM tool-calling infrastructure for the Ping chatbot.
// Used by both the web chatbot (/api/chat) and the Slack DM handler so they
// both behave like a real conversational assistant (Claude/ChatGPT-style)
// instead of rigid intent classification + regex follow-ups.

const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STATUS_LABELS = {
  backlog: 'Inbox',
  active: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
};

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'create_tasks',
      description: 'Create one or more new tasks for the user. Use whenever the user clearly wants to create/add tasks.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Tasks to create.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Clean task title (no filler words).' },
                status: {
                  type: 'string',
                  enum: ['backlog', 'active', 'in_progress', 'completed'],
                  description: 'Optional. Defaults to "active" (To Do) when omitted.',
                },
              },
              required: ['title'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Rename a single task or change its status. Match the task by its id or by a substring of its title.',
      parameters: {
        type: 'object',
        properties: {
          task_identifier: { type: 'string', description: 'Task id (UUID) or a substring of the task title.' },
          new_title: { type: 'string', description: 'New title for the task.' },
          status: { type: 'string', enum: ['backlog', 'active', 'in_progress', 'completed'] },
        },
        required: ['task_identifier'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_tasks',
      description: 'Move one or more tasks to a different status column. Common phrasings: "mark X as done", "move to in progress", "send X back to inbox".',
      parameters: {
        type: 'object',
        properties: {
          task_identifiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task ids (UUIDs) or substrings of task titles.',
          },
          target_status: { type: 'string', enum: ['backlog', 'active', 'in_progress', 'completed'] },
        },
        required: ['task_identifiers', 'target_status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_tasks',
      description: 'Permanently delete one or more tasks. Use when the user says things like "delete X", "remove X", "get rid of X".',
      parameters: {
        type: 'object',
        properties: {
          task_identifiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task ids (UUIDs) or substrings of task titles.',
          },
        },
        required: ['task_identifiers'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List the user\'s tasks, optionally filtered by status. Use this when the user asks to see their tasks or asks "how many tasks in X?".',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['backlog', 'active', 'in_progress', 'completed', 'all'],
            description: 'Which column to list. Omit or use "all" for everything.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_summary',
      description: 'Return counts of tasks across all statuses. Use for "what\'s on my plate", "give me a summary", etc.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const SYSTEM_PROMPT = `You are Ping, a friendly conversational task management assistant — natural and helpful like Claude or ChatGPT, but specialized for task management. You have tools to create, update, move, delete, and list the user's tasks.

Behavior:
- Be natural and conversational. Keep replies short (1-3 sentences) unless listing tasks.
- When the user clearly wants to do something task-related, CALL THE APPROPRIATE TOOL. Do not ask redundant confirmation questions for small actions.
- If the user asks a question that doesn't need a tool (greetings, chit-chat, clarifications), just reply conversationally.
- After a tool call succeeds, confirm briefly (e.g. "Done — created 2 tasks." / "Moved \"fix login\" to Done.").
- If a task identifier matches multiple tasks, pick the closest match and mention which one you picked.
- Status vocabulary mapping:
  - "inbox" / "backlog" → backlog
  - "to do" / "todo" / "to-do" → active
  - "in progress" / "in-progress" / "working on" / "doing" → in_progress
  - "done" / "complete" / "completed" / "finished" → completed
- When the user says "create this task X", "add X", "remind me to X", call create_tasks.
- When the user asks "how many tasks in todo?" call list_tasks with status="active" and respond with the count.
- Keep a warm tone. Use an occasional emoji (checkmark, sparkle) — not every message.`;

function buildTaskContextString(taskContext) {
  const lines = ['Current tasks snapshot:'];
  for (const status of ['backlog', 'active', 'in_progress', 'completed']) {
    const label = STATUS_LABELS[status];
    const list = taskContext[status] || [];
    if (list.length === 0) {
      lines.push(`- ${label}: (none)`);
    } else {
      const sample = list.slice(0, 25).map(t => `"${t.title}" [id:${t.id}]`).join(', ');
      const suffix = list.length > 25 ? ` … (+${list.length - 25} more)` : '';
      lines.push(`- ${label} (${list.length}): ${sample}${suffix}`);
    }
  }
  return lines.join('\n');
}

// Resolve a task identifier (UUID or title substring) to an actual task id from the in-memory list.
function resolveTaskId(identifier, tasks) {
  if (!identifier) return null;
  const exact = tasks.find(t => t.id === identifier);
  if (exact) return exact.id;
  const lower = String(identifier).toLowerCase().trim();
  if (!lower) return null;
  // Prefer the shortest title match (tighter match)
  const matches = tasks.filter(t => (t.title || '').toLowerCase().includes(lower));
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.title || '').length - (b.title || '').length);
  return matches[0].id;
}

async function executeTool(name, args, ctx) {
  const { supabase, userId, teamId, workspaceId, allTasks } = ctx;

  try {
    if (name === 'create_tasks') {
      const toCreate = Array.isArray(args.tasks) ? args.tasks : [];
      const created = [];
      for (const t of toCreate) {
        const title = String(t.title || '').trim();
        if (!title) continue;
        const insert = {
          title,
          user_id: userId,
          status: t.status || 'active',
        };
        if (teamId) insert.team_id = teamId;
        if (workspaceId) insert.workspace_id = workspaceId;
        const { data, error } = await supabase.from('tasks').insert(insert).select().single();
        if (!error && data) {
          created.push(data);
          allTasks.push(data);
        } else if (error) {
          console.error('[tools.create_tasks]', error.message);
        }
      }
      return {
        created: created.length,
        tasks: created.map(t => ({ id: t.id, title: t.title, status: t.status })),
      };
    }

    if (name === 'update_task') {
      const id = resolveTaskId(args.task_identifier, allTasks);
      if (!id) return { error: 'No matching task found.' };
      const updates = {};
      if (args.new_title) updates.title = String(args.new_title).trim();
      if (args.status) {
        updates.status = args.status;
        updates.status_changed_at = new Date().toISOString();
        updates.completed_at = args.status === 'completed' ? new Date().toISOString() : null;
      }
      if (Object.keys(updates).length === 0) return { error: 'Nothing to update.' };
      const { error } = await supabase.from('tasks').update(updates).eq('id', id);
      if (error) return { error: error.message };
      const target = allTasks.find(t => t.id === id);
      if (target) Object.assign(target, updates);
      return { updated: true, task_id: id, title: target?.title };
    }

    if (name === 'move_tasks') {
      const ids = (args.task_identifiers || [])
        .map(ref => resolveTaskId(ref, allTasks))
        .filter(Boolean);
      if (ids.length === 0) return { error: 'No matching tasks found.' };
      const status = args.target_status;
      const updates = {
        status,
        status_changed_at: new Date().toISOString(),
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      };
      let moved = 0;
      const movedTitles = [];
      for (const id of ids) {
        const { error } = await supabase.from('tasks').update(updates).eq('id', id);
        if (!error) {
          moved++;
          const t = allTasks.find(x => x.id === id);
          if (t) { movedTitles.push(t.title); Object.assign(t, updates); }
        }
      }
      return { moved, target_status: status, target_label: STATUS_LABELS[status], titles: movedTitles };
    }

    if (name === 'delete_tasks') {
      const ids = (args.task_identifiers || [])
        .map(ref => resolveTaskId(ref, allTasks))
        .filter(Boolean);
      if (ids.length === 0) return { error: 'No matching tasks found.' };
      let deleted = 0;
      const deletedTitles = [];
      for (const id of ids) {
        const t = allTasks.find(x => x.id === id);
        await supabase.from('updates').delete().eq('task_id', id);
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (!error) {
          deleted++;
          if (t) deletedTitles.push(t.title);
          const idx = allTasks.findIndex(x => x.id === id);
          if (idx >= 0) allTasks.splice(idx, 1);
        }
      }
      return { deleted, titles: deletedTitles };
    }

    if (name === 'list_tasks') {
      const filter = args.status;
      let list = allTasks;
      if (filter && filter !== 'all') list = list.filter(t => t.status === filter);
      return {
        count: list.length,
        status: filter || 'all',
        label: filter && filter !== 'all' ? STATUS_LABELS[filter] : 'all columns',
        tasks: list.slice(0, 50).map(t => ({ title: t.title, status: t.status, label: STATUS_LABELS[t.status] })),
      };
    }

    if (name === 'get_summary') {
      return {
        backlog: allTasks.filter(t => t.status === 'backlog').length,
        active: allTasks.filter(t => t.status === 'active').length,
        in_progress: allTasks.filter(t => t.status === 'in_progress').length,
        completed: allTasks.filter(t => t.status === 'completed').length,
        total: allTasks.length,
      };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`[tools.${name}] ERROR:`, err.message);
    return { error: err.message || String(err) };
  }
}

/**
 * Run one conversational turn with Groq tool calling.
 *
 * @param {object} opts
 * @param {string} opts.userMessage - Latest user message.
 * @param {Array}  opts.history - Prior messages [{role:'user'|'assistant'|'tool', content, tool_call_id?, tool_calls?}].
 *                                Should NOT include the system prompt (we prepend it).
 * @param {object} opts.taskContext - {backlog, active, in_progress, completed}
 * @param {object} opts.ctx - { supabase, userId, teamId, workspaceId }
 * @returns {Promise<{reply:string, executed:boolean, toolCalls:Array, updatedHistory:Array}>}
 */
async function runConversation({ userMessage, history = [], taskContext, ctx }) {
  if (!process.env.GROQ_API_KEY) {
    return {
      reply: '⚠️ AI assistant is not configured. GROQ_API_KEY is missing.',
      executed: false,
      toolCalls: [],
      updatedHistory: history,
    };
  }

  const allTasks = [
    ...(taskContext.backlog || []),
    ...(taskContext.active || []),
    ...(taskContext.in_progress || []),
    ...(taskContext.completed || []),
  ];
  const toolCtx = { ...ctx, allTasks };

  const systemMsg = {
    role: 'system',
    content: `${SYSTEM_PROMPT}\n\n${buildTaskContextString(taskContext)}`,
  };

  const convo = [systemMsg, ...history, { role: 'user', content: userMessage }];
  const toolCalls = [];
  let executed = false;

  for (let round = 0; round < 5; round++) {
    let resp;
    try {
      resp = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: convo,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1024,
      });
    } catch (err) {
      console.error('[runConversation] Groq error:', err.message);
      return {
        reply: "Sorry, I'm having trouble right now. Please try again in a moment.",
        executed,
        toolCalls,
        updatedHistory: history,
      };
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) break;

    // Record the assistant message (with tool_calls if present)
    convo.push({
      role: 'assistant',
      content: msg.content || '',
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    });

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        let parsed = {};
        try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { parsed = {}; }
        const result = await executeTool(call.function.name, parsed, toolCtx);
        executed = true;
        toolCalls.push({ name: call.function.name, args: parsed, result });
        convo.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // let the model respond to the tool results
    }

    // Plain textual reply — done.
    const reply = (msg.content || '').trim();
    // Strip the system message before returning history to callers
    const updatedHistory = convo.slice(1);
    return { reply, executed, toolCalls, updatedHistory };
  }

  return {
    reply: "I wasn't able to finish that. Could you rephrase?",
    executed,
    toolCalls,
    updatedHistory: history,
  };
}

module.exports = {
  runConversation,
  executeTool,
  TOOL_DEFINITIONS,
  SYSTEM_PROMPT,
  STATUS_LABELS,
  buildTaskContextString,
  resolveTaskId,
};
