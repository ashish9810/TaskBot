const { parseTasks, extractTasksFromThread, formatThreadForLLM } = require('./parse-tasks');
const { activeStandups, handleStandupReply } = require('./standup');
const { runConversation, STATUS_LABELS } = require('./tools');

// Helper to get team_id from body
function getTeamId(body) {
  return body.team_id || body.team?.id || '';
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function buildNavBar(activeMode) {
  const btn = (text, actionId, mode) => ({
    type: "button",
    text: { type: "plain_text", text },
    action_id: actionId,
    ...(activeMode === mode ? { style: "primary" } : {})
  });

  return {
    type: "actions",
    elements: [
      btn("My Tasks", "nav_my_tasks", "tasks"),
      // btn("People", "nav_people", "people"),  // Hidden — emails exposed feels spooky
      // btn("📌 Pinned", "nav_pinned", "pinned"),  // Hidden for now
    ]
  };
}

// =============================
// SYNC USERS
// =============================

async function syncUsers(client, teamId, supabase) {
  let allMembers = [];
  let cursor;

  do {
    const result = await client.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
    allMembers = allMembers.concat(result.members || []);
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`[syncUsers] Fetched ${allMembers.length} members for team ${teamId}`);

  let synced = 0, skipped = 0, errors = 0;
  for (const member of allMembers) {
    if (member.is_bot || member.deleted || !member.profile) { skipped++; continue; }

    const { error } = await supabase.from('users').upsert({
      slack_user_id: member.id,
      team_id: teamId,
      name: member.real_name || member.profile.display_name || member.name,
      email: member.profile.email || null
    }, { onConflict: 'slack_user_id,team_id' });

    if (error) {
      console.error(`[syncUsers] upsert failed for ${member.id}:`, error.message, error.details, error.hint);
      errors++;
    } else {
      synced++;
    }
  }
  console.log(`[syncUsers] Done — synced: ${synced}, skipped (bots/deleted): ${skipped}, errors: ${errors}`);
}

function syncUsersBackground(client, teamId, supabase) {
  syncUsers(client, teamId, supabase).catch(err =>
    console.error('syncUsers background error:', err)
  );
}

// Helper: look up workspace_id for a given Slack team_id
async function getWorkspaceId(teamId, supabase) {
  const { data } = await supabase
    .from('workspaces')
    .select('id')
    .eq('slack_team_id', teamId)
    .single();
  return data?.id || null;
}

// =============================
// VIEW BUILDERS
// =============================

async function buildMyTasksView(userId, teamId, supabase) {
  let blocks = [];

  blocks.push(buildNavBar('tasks'));
  blocks.push({ type: "divider" });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "➕ Add New Task" },
        style: "primary",
        action_id: "add_task"
      }
    ]
  });

  blocks.push({ type: "divider" });

  const [
    { data: allTasks },
    { data: allUpdatesRaw }
  ] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).eq('team_id', teamId).order('created_at', { ascending: false }),
    supabase.from('updates').select('id, task_id').eq('user_id', userId).eq('team_id', teamId)
  ]);

  const MAX_TASKS = 5; // Slack limit: 100 blocks per view
  const backlog    = (allTasks || []).filter(t => t.status === 'backlog');
  const active     = (allTasks || []).filter(t => t.status === 'active');
  const inProgress = (allTasks || []).filter(t => t.status === 'in_progress');
  const completed  = (allTasks || []).filter(t => t.status === 'completed')
                       .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  let updatesByTaskId = {};
  for (const upd of (allUpdatesRaw || [])) {
    updatesByTaskId[upd.task_id] = (updatesByTaskId[upd.task_id] || 0) + 1;
  }

  // INBOX
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📥 Inbox${backlog.length > 0 ? ` (${backlog.length})` : ''}` }
  });

  if (!backlog || backlog.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No incoming tasks._" }
    });
  } else {
    for (const task of backlog.slice(0, MAX_TASKS)) {
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title}*` },
          { type: "mrkdwn", text: `📅 Assigned: ${formatDate(task.created_at)}${task.assigned_by ? ` by <@${task.assigned_by}>` : ''}` }
        ]
      });

      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "📋 Move to To Do" },
            style: "primary",
            value: task.id,
            action_id: "backlog_to_todo"
          },
          {
            type: "button",
            text: { type: "plain_text", text: "🗑 Delete" },
            style: "danger",
            value: task.id,
            action_id: "delete_task"
          }
        ]
      });
      blocks.push({ type: "divider" });
    }
    if (backlog.length > MAX_TASKS) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_...and ${backlog.length - MAX_TASKS} more in inbox_` }] });
    }
  }

  // TO DO
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "📋 To Do" }
  });

  if (!active || active.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No tasks to do. Add one above!_" }
    });
  } else {
    for (const task of active.slice(0, MAX_TASKS)) {
      const hasUpdates = (updatesByTaskId[task.id] || 0) > 0;
      const updateCount = updatesByTaskId[task.id] || 0;

      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title}*` },
          { type: "mrkdwn", text: `📅 Created: ${formatDate(task.created_at)}` }
        ]
      });

      const buttons = [];

      if (hasUpdates) {
        buttons.push({
          type: "button",
          text: { type: "plain_text", text: `💬 View Updates (${updateCount})` },
          value: task.id,
          action_id: "view_updates"
        });
      }

      buttons.push(
        {
          type: "button",
          text: { type: "plain_text", text: "📝 Add Update" },
          value: task.id,
          action_id: "update_progress"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "▶ In Progress" },
          value: task.id,
          action_id: "inprogress_task"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Complete" },
          style: "primary",
          value: task.id,
          action_id: "complete_task"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🗑 Delete" },
          style: "danger",
          value: task.id,
          action_id: "delete_task"
        }
      );

      blocks.push({ type: "actions", elements: buttons });
      blocks.push({ type: "divider" });
    }
    if (active.length > MAX_TASKS) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_...and ${active.length - MAX_TASKS} more to do_` }] });
    }
  }

  // IN PROGRESS
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "▶ In Progress" }
  });

  if (!inProgress || inProgress.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No tasks in progress._" }
    });
  } else {
    for (const task of inProgress.slice(0, MAX_TASKS)) {
      const hasUpdates = (updatesByTaskId[task.id] || 0) > 0;
      const updateCount = updatesByTaskId[task.id] || 0;

      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title}*` },
          { type: "mrkdwn", text: `📅 Started: ${formatDate(task.created_at)}` }
        ]
      });

      const buttons = [];

      if (hasUpdates) {
        buttons.push({
          type: "button",
          text: { type: "plain_text", text: `💬 View Updates (${updateCount})` },
          value: task.id,
          action_id: "view_updates"
        });
      }

      buttons.push(
        {
          type: "button",
          text: { type: "plain_text", text: "📝 Add Update" },
          value: task.id,
          action_id: "update_progress"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Complete" },
          style: "primary",
          value: task.id,
          action_id: "complete_task"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🗑 Delete" },
          style: "danger",
          value: task.id,
          action_id: "delete_task"
        }
      );

      blocks.push({ type: "actions", elements: buttons });
      blocks.push({ type: "divider" });
    }
    if (inProgress.length > MAX_TASKS) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_...and ${inProgress.length - MAX_TASKS} more in progress_` }] });
    }
  }

  // COMPLETED
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "✅ Done" }
  });

  if (!completed || completed.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No completed tasks yet._" }
    });
  } else {
    for (const task of completed.slice(0, MAX_TASKS)) {
      const hasUpdates = (updatesByTaskId[task.id] || 0) > 0;
      const updateCount = updatesByTaskId[task.id] || 0;

      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title}*` },
          { type: "mrkdwn", text: `🏁 Completed: ${formatDate(task.completed_at)}` }
        ]
      });

      if (hasUpdates) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: `💬 View Updates (${updateCount})` },
              value: task.id,
              action_id: "view_updates"
            }
          ]
        });
      }

      blocks.push({ type: "divider" });
    }
    if (completed.length > MAX_TASKS) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_...and ${completed.length - MAX_TASKS} more completed_` }] });
    }
  }

  return blocks;
}


const PEOPLE_PAGE_SIZE = 20;

async function buildPeopleView(userId, teamId, supabase, searchQuery = '', page = 0) {
  let blocks = [];

  blocks.push(buildNavBar('people'));
  blocks.push({ type: "divider" });

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "👥 People" }
  });

  blocks.push({
    type: "input",
    block_id: "people_search_block",
    dispatch_action: true,
    element: {
      type: "plain_text_input",
      action_id: "people_search",
      placeholder: { type: "plain_text", text: "Search by name or email..." },
      initial_value: searchQuery
    },
    label: { type: "plain_text", text: "🔍 Search" },
    optional: true
  });

  blocks.push({ type: "divider" });

  const [
    { data: allUsers },
    { data: pins }
  ] = await Promise.all([
    supabase.from('users').select('slack_user_id, name, email').eq('team_id', teamId).order('name'),
    supabase.from('favorites').select('favorite_user_id').eq('manager_user_id', userId).eq('team_id', teamId)
  ]);

  const pinnedIds = new Set((pins || []).map(p => p.favorite_user_id));

  const q = (searchQuery || '').toLowerCase().trim();
  const filtered = (allUsers || []).filter(u => {
    if (!q) return true;
    return (u.name || '').toLowerCase().includes(q) ||
           (u.email || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No users found matching your search._" }
    });
    return blocks;
  }

  const totalPages = Math.ceil(filtered.length / PEOPLE_PAGE_SIZE);
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PEOPLE_PAGE_SIZE, (currentPage + 1) * PEOPLE_PAGE_SIZE);

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `_Showing ${currentPage * PEOPLE_PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PEOPLE_PAGE_SIZE, filtered.length)} of ${filtered.length} people_` }
  });

  for (const user of paginated) {
    const isPinned = pinnedIds.has(user.slack_user_id);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${user.name || 'Unknown'}*\n${user.email || '_no email_'}`
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: isPinned ? "Unpin" : "📌 Pin" },
        value: `${user.slack_user_id}:people`,
        action_id: isPinned ? "unpin_employee" : "pin_employee"
      }
    });

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Tasks" },
          value: user.slack_user_id,
          action_id: "view_person_tasks"
        }
      ]
    });

    blocks.push({ type: "divider" });
  }

  const navElements = [];
  if (currentPage > 0) {
    navElements.push({
      type: "button",
      text: { type: "plain_text", text: "← Prev" },
      value: `${currentPage - 1}:${searchQuery}`,
      action_id: "people_prev_page"
    });
  }
  if (currentPage < totalPages - 1) {
    navElements.push({
      type: "button",
      text: { type: "plain_text", text: "Next →" },
      value: `${currentPage + 1}:${searchQuery}`,
      action_id: "people_next_page"
    });
  }
  if (navElements.length > 0) {
    blocks.push({ type: "actions", elements: navElements });
  }

  return blocks;
}


async function buildPinnedView(userId, teamId, supabase) {
  let blocks = [];

  blocks.push(buildNavBar('pinned'));
  blocks.push({ type: "divider" });

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "📌 Pinned Employees" }
  });

  const { data: pins } = await supabase
    .from('favorites')
    .select('favorite_user_id')
    .eq('manager_user_id', userId)
    .eq('team_id', teamId);

  if (!pins || pins.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_You haven't pinned anyone yet. Go to People to pin someone._"
      }
    });
    return blocks;
  }

  const pinnedIds = pins.map(p => p.favorite_user_id);

  const { data: pinnedUsers } = await supabase
    .from('users')
    .select('slack_user_id, name, email')
    .in('slack_user_id', pinnedIds)
    .eq('team_id', teamId)
    .order('name');

  for (const user of (pinnedUsers || [])) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${user.name || 'Unknown'}*\n${user.email || '_no email_'}`
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Unpin" },
        value: `${user.slack_user_id}:pinned`,
        action_id: "unpin_employee"
      }
    });

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Tasks" },
          value: user.slack_user_id,
          action_id: "view_pinned_tasks"
        }
      ]
    });

    blocks.push({ type: "divider" });
  }

  return blocks;
}


async function buildPersonTasksBlocks(targetUserId, teamId, supabase) {
  const [
    { data: allTasks },
    { data: allUpdatesRaw }
  ] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', targetUserId).eq('team_id', teamId).order('created_at', { ascending: false }),
    supabase.from('updates').select('id, task_id').eq('user_id', targetUserId).eq('team_id', teamId)
  ]);

  const activeTasks    = (allTasks || []).filter(t => t.status === 'active');
  const completedTasks = (allTasks || []).filter(t => t.status === 'completed')
                           .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  const updatesByTaskId = {};
  for (const upd of (allUpdatesRaw || [])) {
    updatesByTaskId[upd.task_id] = (updatesByTaskId[upd.task_id] || 0) + 1;
  }

  let blocks = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🔵 Active Tasks" }
  });

  if (activeTasks.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No active tasks._" }
    });
  } else {
    for (const task of activeTasks) {
      const updateCount = updatesByTaskId[task.id] || 0;

      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title || '(untitled)'}*` },
          { type: "mrkdwn", text: `📅 Created: ${formatDate(task.created_at)}` }
        ]
      });

      if (updateCount > 0) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: `💬 View Updates (${updateCount})` },
              value: task.id,
              action_id: "view_updates"
            }
          ]
        });
      }

      blocks.push({ type: "divider" });
    }
  }

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "✅ Completed Tasks" }
  });

  if (completedTasks.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No completed tasks yet._" }
    });
  } else {
    for (const task of completedTasks) {
      const updateCount = updatesByTaskId[task.id] || 0;

      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title || '(untitled)'}*` },
          { type: "mrkdwn", text: `🏁 Completed: ${formatDate(task.completed_at)}` }
        ]
      });

      if (updateCount > 0) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: `💬 View Updates (${updateCount})` },
              value: task.id,
              action_id: "view_updates"
            }
          ]
        });
      }

      blocks.push({ type: "divider" });
    }
  }

  return blocks;
}


// =============================
// PUBLISH HOME
// =============================

async function publishHome(client, userId, teamId, supabase, mode = 'my_tasks', searchQuery = '', page = 0) {
  // People and Pinned views are hidden — always fall back to my_tasks
  if (mode === 'people' || mode === 'pinned') mode = 'my_tasks';

  let blocks;

  if (mode === 'people') {
    blocks = await buildPeopleView(userId, teamId, supabase, searchQuery, page);
  } else if (mode === 'pinned') {
    blocks = await buildPinnedView(userId, teamId, supabase);
  } else {
    blocks = await buildMyTasksView(userId, teamId, supabase);
  }

  await client.views.publish({
    user_id: userId,
    view: { type: "home", blocks }
  });
}


// Helper: fetch user's tasks grouped by status
async function getUserTaskContext(userId, teamId, supabase) {
  const { data: allTasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, created_at')
    .or(`user_id.eq.${userId}`)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  const tasks = allTasks || [];
  return {
    backlog: tasks.filter(t => t.status === 'backlog'),
    active: tasks.filter(t => t.status === 'active'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    completed: tasks.filter(t => t.status === 'completed'),
  };
}


// =============================
// REGISTER ALL HANDLERS
// =============================

function registerHandlers(app, supabase, maps) {
  const { pendingBulkCreations, dmContext } = maps;

  // ── APP MENTION ──
  app.event('app_mention', async ({ event, client, body }) => {
    const teamId = getTeamId(body);
    const botUserId = body.authorizations?.[0]?.user_id || '';

    const rawText = event.text;
    const text = rawText.replace(/<@[A-Z0-9]+>/g, '').trim();
    const isThreaded = !!event.thread_ts;

    // Empty mention outside a thread → show help.
    // Empty mention inside a thread → fall through and auto-extract tasks.
    if (!text && !isThreaded) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `Hi <@${event.user}>! Here's how to use Ping:\n• *@Ping assign @John fix the login bug, send report, review Q1* — assign tasks to others or yourself\n• *@Ping create PRD for payments, send report to manager* — create tasks for yourself\n• Tag *@Ping* in any thread to extract tasks from the conversation`
      });
      return;
    }

    // ── THREAD TASK EXTRACTION ──
    // Any @Ping mention inside a thread is treated as "read this thread and
    // create tasks" — this matches user expectation (just tag the bot, no
    // keywords needed).
    const isThreadTaskRequest = isThreaded;

    if (isThreadTaskRequest) {
      try {
        await client.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: 'hourglass_flowing_sand'
        }).catch(() => {});

        // Fetch thread messages
        let threadMessages = [];
        let cursor;
        do {
          const result = await client.conversations.replies({
            channel: event.channel,
            ts: event.thread_ts,
            limit: 100,
            inclusive: true,
            ...(cursor ? { cursor } : {}),
          });
          threadMessages = threadMessages.concat(result.messages || []);
          cursor = result.response_metadata?.next_cursor;
        } while (cursor && threadMessages.length < 100);

        // Need at least 2 messages (parent + at least one reply besides the bot mention)
        const humanMsgs = threadMessages.filter(m => !m.bot_id && m.user !== botUserId);
        if (humanMsgs.length < 2) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.thread_ts,
            text: "This thread doesn't seem to have enough conversation to extract tasks from. I need at least a couple of messages to work with."
          });
          await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass_flowing_sand' }).catch(() => {});
          return;
        }

        // Collect unique user IDs from the thread
        const uniqueUserIds = [...new Set(threadMessages.map(m => m.user).filter(Boolean))];

        // Resolve user names from Supabase + Slack API fallback
        const { data: knownUsers } = await supabase
          .from('users')
          .select('slack_user_id, name')
          .eq('team_id', teamId)
          .in('slack_user_id', uniqueUserIds);

        const userMap = new Map();
        for (const u of (knownUsers || [])) {
          userMap.set(u.slack_user_id, u.name);
        }
        // Fallback: fetch names from Slack for any users not in DB
        for (const uid of uniqueUserIds) {
          if (!userMap.has(uid) && uid !== botUserId) {
            try {
              const info = await client.users.info({ user: uid });
              const name = info.user?.real_name || info.user?.profile?.display_name || uid;
              userMap.set(uid, name);
            } catch { /* skip */ }
          }
        }

        // Build participant list for the LLM prompt
        const participantList = [...userMap.entries()]
          .filter(([id]) => id !== botUserId)
          .map(([id, name]) => `${id} = "${name}"`)
          .join('\n');

        const requesterName = userMap.get(event.user) || 'Unknown';

        // Format thread and call LLM
        const formattedThread = formatThreadForLLM(threadMessages, userMap, botUserId);

        let result;
        try {
          result = await extractTasksFromThread(
            formattedThread,
            participantList,
            { slackId: event.user, name: requesterName },
            text
          );
        } catch (err) {
          if (err.status === 429) {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: event.thread_ts,
              text: "I'm a bit busy right now — please try again in about 30 seconds. :hourglass:"
            });
            await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass_flowing_sand' }).catch(() => {});
            return;
          }
          throw err;
        }

        const tasks = result.tasks || [];

        if (tasks.length === 0) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.thread_ts,
            text: "I read through the thread but couldn't identify any clear action items. Try being more specific, e.g.:\n*@Ping create a task for Bob to fix the API bug discussed here*"
          });
          await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass_flowing_sand' }).catch(() => {});
          return;
        }

        // ── AUTO-CREATE TASKS (no checkbox confirmation) ──
        // Self-assigned → status 'active' (To Do).
        // Assigned to someone else → status 'backlog' + DM the assignee with Track/Ignore buttons.
        const workspaceId = await getWorkspaceId(teamId, supabase);
        const webUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        let createdSelf = 0;
        const createdForOthers = []; // { taskId, title, assigneeId, assigneeName }
        const createFailures = [];

        for (const t of tasks) {
          const rawAssignee = t.assignee_slack_id || null;
          const isSelf = !rawAssignee || rawAssignee === event.user;
          const assigneeId = isSelf ? event.user : rawAssignee;
          const status = isSelf ? 'active' : 'backlog';

          const insert = {
            title: t.title,
            user_id: assigneeId,
            team_id: teamId,
            status,
            assigned_by: event.user,
            ...(workspaceId ? { workspace_id: workspaceId } : {}),
          };

          const { data: inserted, error } = await supabase
            .from('tasks')
            .insert(insert)
            .select()
            .single();

          if (error || !inserted) {
            console.error('[thread_auto_create] Insert failed:', error?.message);
            createFailures.push(t.title);
            continue;
          }

          if (isSelf) {
            createdSelf++;
          } else {
            createdForOthers.push({
              taskId: inserted.id,
              title: inserted.title,
              assigneeId,
              assigneeName: userMap.get(assigneeId) || 'teammate',
            });
          }
        }

        // DM each external assignee with Track / Ignore buttons
        for (const assigned of createdForOthers) {
          try {
            await client.chat.postMessage({
              channel: assigned.assigneeId,
              text: `:wave: <@${event.user}> assigned you a task from a thread: ${assigned.title}`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `:wave: Hey! <@${event.user}> assigned you a task from a thread:\n*${assigned.title}*`,
                  },
                },
                {
                  type: 'context',
                  elements: [{
                    type: 'mrkdwn',
                    text: `_From <#${event.channel}>_ · <${webUrl}/dashboard|Open dashboard>`,
                  }],
                },
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':white_check_mark: Track' },
                      style: 'primary',
                      action_id: 'track_assigned_task',
                      value: assigned.taskId,
                    },
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':x: Ignore' },
                      action_id: 'ignore_assigned_task',
                      value: assigned.taskId,
                    },
                  ],
                },
              ],
            });
          } catch (e) {
            console.error('[thread_auto_create] DM to assignee failed (non-fatal):', e.message);
          }
        }

        // Thread summary reply
        const summaryLines = [];
        if (result.summary) summaryLines.push(`:mag: *Thread summary:* ${result.summary}`);
        summaryLines.push('');
        const totalCreated = createdSelf + createdForOthers.length;
        summaryLines.push(`:white_check_mark: Created *${totalCreated} task(s)* from this thread:`);
        if (createdSelf > 0) {
          summaryLines.push(`• *${createdSelf}* added to your To Do (<@${event.user}>).`);
        }
        if (createdForOthers.length > 0) {
          const grouped = {};
          for (const t of createdForOthers) {
            grouped[t.assigneeId] = grouped[t.assigneeId] || [];
            grouped[t.assigneeId].push(t.title);
          }
          for (const [aid, titles] of Object.entries(grouped)) {
            summaryLines.push(`• *${titles.length}* sent to <@${aid}> (awaiting Track/Ignore).`);
          }
        }
        if (createFailures.length > 0) {
          summaryLines.push(`:warning: Couldn't create ${createFailures.length} task(s): ${createFailures.map(t => `"${t}"`).join(', ')}`);
        }

        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.thread_ts,
          text: `Created ${totalCreated} task(s) from this thread.`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: summaryLines.join('\n') },
          }],
        });

        // Refresh requester's home tab if any task was self-assigned
        if (createdSelf > 0) {
          try { await publishHome(client, event.user, teamId, supabase, 'my_tasks'); } catch {}
        }

        await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass_flowing_sand' }).catch(() => {});
        return;
      } catch (err) {
        console.error('[thread_tasks] Error:', err.message);
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.thread_ts || event.ts,
          text: "Sorry, something went wrong while reading this thread. Please try again."
        });
        await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass_flowing_sand' }).catch(() => {});
        return;
      }
    }

    try {
      await client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: 'hourglass_flowing_sand'
      }).catch(() => {});

      const mentionMatches = rawText.match(/<@([A-Z0-9]+)>/g) || [];
      const mentionedUserIds = mentionMatches
        .map(m => m.replace(/<@|>/g, ''))
        .filter(id => id !== botUserId && id !== event.user);

      let mentionedUsers = [];
      if (mentionedUserIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('slack_user_id, name')
          .eq('team_id', teamId)
          .in('slack_user_id', mentionedUserIds);
        mentionedUsers = users || [];
      }

      const memberNames = mentionedUsers.map(u => u.name);
      const nameToSlackId = {};
      for (const u of mentionedUsers) {
        nameToSlackId[u.name.toLowerCase()] = u.slack_user_id;
        const firstName = u.name.split(' ')[0].toLowerCase();
        nameToSlackId[firstName] = u.slack_user_id;
      }

      const isGlobalAssign = /^assign\b/i.test(text) && mentionedUserIds.length === 1;
      const globalAssigneeId = isGlobalAssign ? mentionedUserIds[0] : null;

      const result = await parseTasks(text, memberNames);
      const tasks = result.tasks || [];

      if (tasks.length === 0) {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: `Hi <@${event.user}>! I couldn't find tasks in your message. Try:\n• *@Ping assign @John fix the bug, send report* — assign to someone\n• *@Ping create PRD, review numbers* — create for yourself`
        });
        return;
      }

      for (const task of tasks) {
        if (globalAssigneeId) {
          task.assignee_slack_id = globalAssigneeId;
        } else if (task.assignee_hint && task.assignee_hint !== 'me') {
          const hint = task.assignee_hint.toLowerCase();
          task.assignee_slack_id = nameToSlackId[hint] || null;
        } else {
          task.assignee_slack_id = null;
        }
      }

      pendingBulkCreations.set(event.user, {
        tasks,
        teamId,
        channelId: event.channel,
        threadTs: event.ts,
        mentionedUsers,
        timestamp: Date.now()
      });

      const checkboxOptions = tasks.map((task, i) => {
        let label = task.title.substring(0, 60);
        const assigneeId = task.assignee_slack_id;
        if (assigneeId && assigneeId !== event.user) {
          const assigneeName = mentionedUsers.find(u => u.slack_user_id === assigneeId)?.name?.split(' ')[0] || 'someone';
          label += ` → ${assigneeName}`;
        }
        return {
          text: { type: 'plain_text', text: label.substring(0, 75) },
          value: String(i)
        };
      });

      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `I found ${tasks.length} task(s):`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:clipboard: <@${event.user}>, I found *${tasks.length} task(s)* in your message:`
            }
          },
          {
            type: 'actions',
            block_id: 'bulk_task_checkboxes',
            elements: [
              {
                type: 'checkboxes',
                action_id: 'bulk_task_selection',
                initial_options: checkboxOptions,
                options: checkboxOptions
              }
            ]
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: ':white_check_mark: Create Selected' },
                style: 'primary',
                action_id: 'bulk_create_confirm',
                value: event.user
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: ':x: Cancel' },
                action_id: 'bulk_create_cancel',
                value: event.user
              }
            ]
          }
        ]
      });

      await client.reactions.remove({
        channel: event.channel,
        timestamp: event.ts,
        name: 'hourglass_flowing_sand'
      }).catch(() => {});

    } catch (err) {
      console.error('[app_mention] Error:', err.message);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `Sorry, something went wrong. Try again or use:\n*@Ping assign @John fix the bug, send report*`
      });
    }
  });

  // ── DM MESSAGE ──
  // Fully conversational — powered by Groq tool calling via lib/bot/tools.js.
  // Multi-turn history is persisted in dmContext per-user with a 1-hour TTL.
  app.message(async ({ message, client, say }) => {
    if (message.subtype || message.bot_id) return;
    if (message.channel_type !== 'im') return;

    const userId = message.user;
    const text = (message.text || '').trim();
    if (!text) return;

    const { data: userData } = await supabase
      .from('users')
      .select('team_id')
      .eq('slack_user_id', userId)
      .limit(1)
      .single();

    const teamId = userData?.team_id;
    if (!teamId) {
      await say("I don't recognize you yet. Please make sure Ping is installed in your workspace and try again.");
      return;
    }

    if (activeStandups.has(userId)) {
      const handled = await handleStandupReply(message, userId, say);
      if (handled) return;
    }

    let thinkingTs = null;
    try {
      const thinkingMsg = await client.chat.postMessage({
        channel: message.channel,
        text: ':hourglass_flowing_sand: Thinking...',
      });
      thinkingTs = thinkingMsg.ts;
    } catch (e) {
      console.error('[DM] Failed to post thinking indicator (non-fatal):', e.message);
    }

    const removeThinking = async () => {
      if (thinkingTs) {
        try {
          await client.chat.delete({ channel: message.channel, ts: thinkingTs });
        } catch (e) {
          try {
            await client.chat.update({ channel: message.channel, ts: thinkingTs, text: ' ' });
          } catch {}
        }
        thinkingTs = null;
      }
    };

    try {
      const taskContext = await getUserTaskContext(userId, teamId, supabase);
      const workspaceId = await getWorkspaceId(teamId, supabase);

      // Load persisted conversation history for this user (1-hour TTL, capped at 20 messages).
      const now = Date.now();
      const prev = dmContext.get(userId);
      const freshHistory = prev && prev.chatHistory && (now - (prev.chatTimestamp || 0) < 60 * 60 * 1000)
        ? prev.chatHistory
        : [];

      const result = await runConversation({
        userMessage: text,
        history: freshHistory,
        taskContext,
        ctx: {
          supabase,
          userId,
          teamId,
          workspaceId,
        },
      });

      await removeThinking();

      const reply = result.reply || ":thinking_face: I'm not sure how to help with that — could you rephrase?";
      await say(reply);

      // Persist history (trim to last 20 messages)
      const trimmed = (result.updatedHistory || []).slice(-20);
      dmContext.set(userId, {
        ...(prev || {}),
        chatHistory: trimmed,
        chatTimestamp: now,
        teamId,
        timestamp: now,
      });

      // Refresh home tab if anything was actually executed (created/moved/deleted)
      if (result.executed) {
        try { await publishHome(client, userId, teamId, supabase, 'my_tasks'); } catch {}
      }
    } catch (err) {
      console.error('[DM] Error:', err.message, err.stack);
      await removeThinking();
      await say("Sorry, something went wrong. Please try again.");
    }
  });

  // Acknowledge checkbox interaction (no-op)
  app.action('bulk_task_selection', async ({ ack }) => {
    await ack();
  });

  // ── DM ACTION — confirm / cancel ──
  app.action('dm_action_confirm', async ({ ack, body, client }) => {
    await ack();

    try {
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id || body.user.id;
      const messageTs = body.message?.ts || body.container?.message_ts;
      const ctx = dmContext.get(userId);

      if (!ctx || !ctx.pendingAction || !ctx.pendingAction.tasks) {
        await client.chat.postMessage({ channel: channelId, text: "This action has expired. Please try again." });
        dmContext.delete(userId);
        return;
      }

      const action = ctx.pendingAction;

      if (action.type === 'move') {
        let moved = 0;
        for (const task of action.tasks) {
          const { error } = await supabase.from('tasks').update({ status: action.targetStatus }).eq('id', task.id);
          if (!error) moved++;
        }

        const targetLabel = STATUS_LABELS[action.targetStatus] || action.targetStatus;
        const taskList = action.tasks.map(t => `• ${t.title}`).join('\n');

        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Moved ${moved} task(s) to ${targetLabel}.`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `:white_check_mark: *Done! Moved ${moved} task(s) to ${targetLabel}:*\n${taskList}` }
          }]
        });

        try { await publishHome(client, userId, ctx.teamId, supabase, 'my_tasks'); } catch (e) {}
      }

      if (action.type === 'delete') {
        let deleted = 0;
        for (const task of action.tasks) {
          await supabase.from('updates').delete().eq('task_id', task.id);
          const { error } = await supabase.from('tasks').delete().eq('id', task.id);
          if (!error) deleted++;
        }

        const taskList = action.tasks.map(t => `• ${t.title}`).join('\n');

        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Deleted ${deleted} task(s).`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `:wastebasket: *Deleted ${deleted} task(s):*\n${taskList}` }
          }]
        });

        try { await publishHome(client, userId, ctx.teamId, supabase, 'my_tasks'); } catch (e) {}
      }

      dmContext.set(userId, { ...ctx, pendingAction: null, timestamp: Date.now() });

    } catch (err) {
      console.error('[dm_action_confirm] Error:', err.message, err.stack);
    }
  });

  app.action('dm_action_cancel', async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;
    const channelId = body.channel?.id || body.container?.channel_id || body.user.id;
    const messageTs = body.message?.ts || body.container?.message_ts;

    const ctx = dmContext.get(userId);
    if (ctx) {
      dmContext.set(userId, { ...ctx, pendingAction: null, timestamp: Date.now() });
    }

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "Cancelled.",
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ':x: Cancelled.' } }]
    });
  });

  // ── Bulk create — confirm ──
  app.action('bulk_create_confirm', async ({ ack, body, client }) => {
    await ack();

    try {
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id || body.user.id;
      const messageTs = body.message?.ts || body.container?.message_ts;
      const pending = pendingBulkCreations.get(userId);

      if (!pending) {
        await client.chat.postMessage({
          channel: channelId,
          text: "This request has expired. Please send your tasks again."
        });
        return;
      }

      let selectedIndices = [];
      const checkboxState = body.state?.values?.bulk_task_checkboxes?.bulk_task_selection?.selected_options;
      if (checkboxState && checkboxState.length > 0) {
        selectedIndices = checkboxState.map(opt => parseInt(opt.value));
      }

      if (selectedIndices.length === 0) {
        selectedIndices = pending.tasks.map((_, i) => i);
      }

      const selectedTasks = selectedIndices.map(i => pending.tasks[i]).filter(Boolean);

      if (selectedTasks.length === 0) {
        await client.chat.postMessage({
          channel: channelId,
          text: "No tasks were selected. Please try again."
        });
        pendingBulkCreations.delete(userId);
        return;
      }

      const workspaceId = await getWorkspaceId(pending.teamId, supabase);
      let created = 0;
      const assignedToOthers = [];

      for (const task of selectedTasks) {
        const assigneeId = task.assignee_slack_id || userId;
        const isSelfAssign = assigneeId === userId;

        const { error } = await supabase.from('tasks').insert({
          title: task.title,
          user_id: assigneeId,
          team_id: pending.teamId,
          status: isSelfAssign ? 'active' : 'backlog',
          assigned_by: userId,
          ...(workspaceId ? { workspace_id: workspaceId } : {})
        });

        if (error) {
          console.error('[bulk_create] Insert failed:', error.message);
        } else {
          created++;
          if (!isSelfAssign) {
            assignedToOthers.push({ title: task.title, assigneeId });
          }
        }
      }

      const webUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      for (const assigned of assignedToOthers) {
        try {
          await client.chat.postMessage({
            channel: assigned.assigneeId,
            text: `:wave: Hey! <@${userId}> assigned you a task on Ping:\n*${assigned.title}*\n\n<${webUrl}/dashboard|Click here to view your tasks>`
          });
        } catch (e) {
          console.error('[bulk_create] DM to assignee failed (non-fatal):', e.message);
        }
      }

      pendingBulkCreations.delete(userId);

      const taskList = selectedTasks.map(t => {
        const assigneeId = t.assignee_slack_id || userId;
        return assigneeId !== userId ? `- ${t.title} → <@${assigneeId}>` : `- ${t.title}`;
      }).join('\n');

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Created ${created} task(s) in your To Do list.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:white_check_mark: *Done! Created ${created} task(s) in your To Do:*\n${taskList}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'View them on your dashboard or Slack Home tab.'
              }
            ]
          }
        ]
      });

      try {
        await publishHome(client, userId, pending.teamId, supabase, 'my_tasks');
      } catch (e) {
        console.error('[bulk_create] Home refresh failed (non-fatal):', e.message);
      }

    } catch (err) {
      console.error('[bulk_create_confirm] ERROR:', err.message, err.stack);
    }
  });

  // Bulk create — cancel
  app.action('bulk_create_cancel', async ({ ack, body, client }) => {
    await ack();

    pendingBulkCreations.delete(body.user.id);

    const channelId = body.channel?.id || body.container?.channel_id || body.user.id;
    const messageTs = body.message?.ts || body.container?.message_ts;

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "Task creation cancelled.",
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: ':x: Task creation cancelled.' }
        }
      ]
    });
  });

  // ── THREAD AUTO-ASSIGN — Track (move backlog → active) ──
  app.action('track_assigned_task', async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id || userId;
      const messageTs = body.message?.ts || body.container?.message_ts;
      const taskId = body.actions?.[0]?.value;
      if (!taskId) return;

      // Only allow the assignee themselves to track/ignore
      const { data: task } = await supabase
        .from('tasks')
        .select('id, user_id, title, assigned_by, status')
        .eq('id', taskId)
        .single();

      if (!task) {
        await client.chat.update({
          channel: channelId, ts: messageTs,
          text: 'This task no longer exists.',
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ':information_source: This task no longer exists.' } }],
        });
        return;
      }

      if (task.user_id !== userId) {
        await client.chat.postMessage({ channel: channelId, text: "Only the assignee can act on this." });
        return;
      }

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'active' })
        .eq('id', taskId);

      if (error) {
        console.error('[track_assigned_task] update failed:', error.message);
        return;
      }

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Tracking: ${task.title}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `:white_check_mark: *Tracking:* ${task.title}\n_Added to your To Do._` },
        }],
      });

      // Refresh home tab for the assignee
      try {
        const { data: u } = await supabase.from('users').select('team_id').eq('slack_user_id', userId).limit(1).single();
        if (u?.team_id) await publishHome(client, userId, u.team_id, supabase, 'my_tasks');
      } catch {}
    } catch (err) {
      console.error('[track_assigned_task] Error:', err.message, err.stack);
    }
  });

  // ── THREAD AUTO-ASSIGN — Ignore (delete the task) ──
  app.action('ignore_assigned_task', async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id || userId;
      const messageTs = body.message?.ts || body.container?.message_ts;
      const taskId = body.actions?.[0]?.value;
      if (!taskId) return;

      const { data: task } = await supabase
        .from('tasks')
        .select('id, user_id, title')
        .eq('id', taskId)
        .single();

      if (!task) {
        await client.chat.update({
          channel: channelId, ts: messageTs,
          text: 'This task no longer exists.',
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ':information_source: This task no longer exists.' } }],
        });
        return;
      }

      if (task.user_id !== userId) {
        await client.chat.postMessage({ channel: channelId, text: "Only the assignee can act on this." });
        return;
      }

      await supabase.from('updates').delete().eq('task_id', taskId);
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) {
        console.error('[ignore_assigned_task] delete failed:', error.message);
        return;
      }

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Ignored: ${task.title}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `:wastebasket: *Ignored:* ${task.title}\n_Task removed._` },
        }],
      });
    } catch (err) {
      console.error('[ignore_assigned_task] Error:', err.message, err.stack);
    }
  });

  // ── STANDUP — confirm / go back ──
  app.action('standup_confirm', async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;
    const standup = activeStandups.get(userId);

    if (!standup || !standup.selectedTaskIds || standup.selectedTaskIds.length === 0) {
      await client.chat.postMessage({
        channel: body.channel?.id || body.container?.channel_id || body.user.id,
        text: "This standup session has expired. I'll check in with you again tomorrow!"
      });
      activeStandups.delete(userId);
      return;
    }

    const isEvening = standup.actionType === 'complete';
    const targetStatus = isEvening ? 'completed' : 'in_progress';
    const targetLabel = isEvening ? 'Done' : 'In Progress';

    let count = 0;
    for (const taskId of standup.selectedTaskIds) {
      const updates = { status: targetStatus };
      if (isEvening) updates.completed_at = new Date().toISOString();
      const { error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', taskId);
      if (!error) count++;
    }

    activeStandups.delete(userId);

    const remaining = (standup.todoTasks || []).length - count;
    const emoji = isEvening ? ':white_check_mark:' : ':rocket:';
    const msg = isEvening
      ? `${emoji} *Marked ${count} task(s) as Done!*\nGreat work today! :star:`
      : `${emoji} *Moved ${count} task(s) to In Progress.*\nHave a productive day!${remaining > 0 ? `\n\nYou still have ${remaining} task(s) in To Do for later.` : ''}`;

    await client.chat.update({
      channel: body.channel?.id || body.container?.channel_id || body.user.id,
      ts: body.message?.ts || body.container?.message_ts,
      text: msg.replace(/[*:]/g, ''),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: msg }
        }
      ]
    });

    try {
      await publishHome(client, userId, standup.teamId, supabase, 'my_tasks');
    } catch (e) {
      console.error('[standup_confirm] Home refresh failed (non-fatal):', e.message);
    }
  });

  app.action('standup_go_back', async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;
    const standup = activeStandups.get(userId);

    if (!standup) {
      await client.chat.postMessage({
        channel: body.channel?.id || body.container?.channel_id || body.user.id,
        text: "This standup session has expired."
      });
      return;
    }

    standup.state = 'awaiting_selection';
    standup.selectedTaskIds = [];
    standup.expiresAt = Date.now() + 30 * 60 * 1000;

    const todoList = standup.todoTasks.map(t => `${t.index}. ${t.title}`).join('\n');

    await client.chat.update({
      channel: body.channel?.id || body.container?.channel_id || body.user.id,
      ts: body.message?.ts || body.container?.message_ts,
      text: 'No problem! Which tasks do you want to work on?',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `No problem! Here are your To Do tasks again:\n${todoList}\n\nWhich ones are you working on today?`
          }
        }
      ]
    });
  });

  // ── SLACK APP UNINSTALL ──
  app.event('app_uninstalled', async ({ body }) => {
    const teamId = body.team_id || '';
    console.log(`[app_uninstalled] Team ${teamId} uninstalled Ping`);
    await supabase.from('installations').delete().eq('team_id', teamId);
    await supabase.from('workspaces').update({ slack_team_id: null }).eq('slack_team_id', teamId);
  });

  app.event('tokens_revoked', async ({ body }) => {
    const teamId = body.team_id || '';
    console.log(`[tokens_revoked] Tokens revoked for team ${teamId}`);
    await supabase.from('installations').delete().eq('team_id', teamId);
    await supabase.from('workspaces').update({ slack_team_id: null }).eq('slack_team_id', teamId);
  });

  // ── HOME EVENT ──
  app.event('app_home_opened', async ({ event, client, body }) => {
    const teamId = getTeamId(body);

    const { data: existingUser } = await supabase
      .from('users')
      .select('slack_user_id')
      .eq('slack_user_id', event.user)
      .eq('team_id', teamId)
      .single();

    if (!existingUser) syncUsersBackground(client, teamId, supabase);

    await publishHome(client, event.user, teamId, supabase, 'my_tasks');
  });

  // ── NAVIGATION ──
  app.action('nav_my_tasks', async ({ ack, body, client }) => {
    await ack();
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'my_tasks');
  });

  app.action('nav_people', async ({ ack, body, client }) => {
    await ack();
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'people');
  });

  app.action('nav_pinned', async ({ ack, body, client }) => {
    await ack();
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'pinned');
  });

  // ── ADD TASK ──
  app.action('add_task', async ({ ack, body, client }) => {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "submit_task",
        private_metadata: getTeamId(body),
        title: { type: "plain_text", text: "Add Task" },
        submit: { type: "plain_text", text: "Create" },
        blocks: [
          {
            type: "input",
            block_id: "task",
            element: {
              type: "plain_text_input",
              action_id: "name",
              placeholder: { type: "plain_text", text: "What do you need to do?" }
            },
            label: { type: "plain_text", text: "Task Name" }
          }
        ]
      }
    });
  });

  app.view('submit_task', async ({ ack, body, view, client }) => {
    await ack();

    const title = view.state.values.task.name.value;
    const teamId = view.private_metadata;

    const workspaceId = await getWorkspaceId(teamId, supabase);
    await supabase.from('tasks').insert({
      title,
      user_id: body.user.id,
      team_id: teamId,
      status: "active",
      ...(workspaceId ? { workspace_id: workspaceId } : {})
    });

    await publishHome(client, body.user.id, teamId, supabase, 'my_tasks');
  });

  // ── UPDATE PROGRESS ──
  app.action('update_progress', async ({ ack, body, client }) => {
    await ack();

    const taskId = body.actions[0].value;
    const teamId = getTeamId(body);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "submit_update",
        private_metadata: JSON.stringify({ taskId, teamId }),
        title: { type: "plain_text", text: "Add Progress Update" },
        submit: { type: "plain_text", text: "Save" },
        blocks: [
          {
            type: "input",
            block_id: "update",
            element: {
              type: "plain_text_input",
              multiline: true,
              action_id: "content",
              placeholder: { type: "plain_text", text: "What progress have you made?" }
            },
            label: { type: "plain_text", text: "Progress Update" }
          }
        ]
      }
    });
  });

  app.view('submit_update', async ({ ack, body, view, client }) => {
    await ack();

    const { taskId, teamId } = JSON.parse(view.private_metadata);

    await supabase.from('updates').insert({
      task_id: taskId,
      content: view.state.values.update.content.value,
      user_id: body.user.id,
      team_id: teamId
    });

    await publishHome(client, body.user.id, teamId, supabase, 'my_tasks');
  });

  // ── VIEW UPDATES ──
  app.action('view_updates', async ({ ack, body, client }) => {
    await ack();

    const taskId = body.actions[0].value;
    const teamId = getTeamId(body);
    const fromModal = body.view?.type === 'modal';

    let parentMeta = {};
    if (fromModal && body.view.private_metadata) {
      try {
        parentMeta = JSON.parse(body.view.private_metadata);
      } catch {
        parentMeta = { targetUserId: body.view.private_metadata };
      }
    }

    const [
      { data: task },
      { data: updates }
    ] = await Promise.all([
      supabase.from('tasks').select('title, user_id').eq('id', taskId).single(),
      supabase.from('updates').select('*').eq('task_id', taskId).order('created_at', { ascending: false })
    ]);

    let blocks = [];

    if (fromModal) {
      const backUserId = parentMeta.targetUserId || task?.user_id || '';
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "← Back" },
            value: JSON.stringify({ targetUserId: backUserId, teamId }),
            action_id: "back_to_person_tasks"
          }
        ]
      });
      blocks.push({ type: "divider" });
    }

    if (!updates || updates.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No updates yet._" }
      });
    } else {
      for (const update of updates) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${formatDate(update.created_at)}*\n${update.content}`
          }
        });
        blocks.push({ type: "divider" });
      }
    }

    const titleText = (task?.title || 'Updates').substring(0, 24);

    const modalView = {
      type: "modal",
      title: { type: "plain_text", text: titleText },
      private_metadata: JSON.stringify({ targetUserId: parentMeta.targetUserId || task?.user_id || '', teamId }),
      blocks
    };

    if (fromModal) {
      await client.views.update({ view_id: body.view.id, view: modalView });
    } else {
      await client.views.open({ trigger_id: body.trigger_id, view: modalView });
    }
  });

  // ── BACK TO PERSON TASKS ──
  app.action('back_to_person_tasks', async ({ ack, body, client }) => {
    await ack();

    const { targetUserId, teamId } = JSON.parse(body.actions[0].value);

    const [
      { data: targetUser },
      taskBlocks
    ] = await Promise.all([
      supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
      buildPersonTasksBlocks(targetUserId, teamId, supabase)
    ]);

    const name = (targetUser?.name || 'User').split(' ')[0];

    await client.views.update({
      view_id: body.view.id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: `${name}'s Tasks` },
        private_metadata: JSON.stringify({ targetUserId, teamId }),
        blocks: taskBlocks
      }
    });
  });

  // ── COMPLETE TASK ──
  app.action('complete_task', async ({ ack, body, client }) => {
    await ack();

    await supabase.from('tasks').update({
      status: "completed",
      completed_at: new Date()
    }).eq('id', body.actions[0].value);

    await publishHome(client, body.user.id, getTeamId(body), supabase, 'my_tasks');
  });

  // ── BACKLOG TO TODO ──
  app.action('backlog_to_todo', async ({ ack, body, client }) => {
    await ack();

    await supabase.from('tasks').update({
      status: "active"
    }).eq('id', body.actions[0].value);

    await publishHome(client, body.user.id, getTeamId(body), supabase, 'my_tasks');
  });

  // ── IN PROGRESS TASK ──
  app.action('inprogress_task', async ({ ack, body, client }) => {
    await ack();

    await supabase.from('tasks').update({
      status: "in_progress"
    }).eq('id', body.actions[0].value);

    await publishHome(client, body.user.id, getTeamId(body), supabase, 'my_tasks');
  });

  // ── DELETE TASK ──
  app.action('delete_task', async ({ ack, body, client }) => {
    await ack();

    const taskId = body.actions[0].value;
    await supabase.from('updates').delete().eq('task_id', taskId);
    await supabase.from('tasks').delete().eq('id', taskId);

    await publishHome(client, body.user.id, getTeamId(body), supabase, 'my_tasks');
  });

  // ── PEOPLE SEARCH ──
  app.action('people_search', async ({ ack, body, client }) => {
    await ack();
    const searchQuery = body.actions[0].value || '';
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'people', searchQuery, 0);
  });

  app.action('people_prev_page', async ({ ack, body, client }) => {
    await ack();
    const [pageStr, ...rest] = (body.actions[0].value || '0:').split(':');
    const searchQuery = rest.join(':');
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'people', searchQuery, parseInt(pageStr));
  });

  app.action('people_next_page', async ({ ack, body, client }) => {
    await ack();
    const [pageStr, ...rest] = (body.actions[0].value || '0:').split(':');
    const searchQuery = rest.join(':');
    await publishHome(client, body.user.id, getTeamId(body), supabase, 'people', searchQuery, parseInt(pageStr));
  });

  // ── VIEW PERSON TASKS (modal) ──
  app.action('view_person_tasks', async ({ ack, body, client }) => {
    await ack();

    const targetUserId = body.actions[0].value;
    const teamId = getTeamId(body);

    const openResult = await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Loading..." },
        close: { type: "plain_text", text: "Close" },
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "_Loading tasks..._" } }]
      }
    });

    const viewId = openResult?.view?.id;
    if (!viewId) {
      console.error('[view_person_tasks] Failed to open modal — no view ID returned');
      return;
    }

    try {
      const [
        { data: targetUser },
        taskBlocks
      ] = await Promise.all([
        supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
        buildPersonTasksBlocks(targetUserId, teamId, supabase)
      ]);

      const name = (targetUser?.name || 'User').split(' ')[0];

      await client.views.update({
        view_id: viewId,
        view: {
          type: "modal",
          title: { type: "plain_text", text: `${name}'s Tasks` },
          close: { type: "plain_text", text: "Close" },
          private_metadata: JSON.stringify({ targetUserId, teamId }),
          blocks: taskBlocks.slice(0, 100)
        }
      });
    } catch (err) {
      console.error('[view_person_tasks] Failed to load tasks:', err?.message || err, err?.data || '');
      await client.views.update({
        view_id: viewId,
        view: {
          type: "modal",
          title: { type: "plain_text", text: "Error" },
          close: { type: "plain_text", text: "Close" },
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "_Failed to load tasks. Please try again._" } }]
        }
      }).catch(() => {});
    }
  });

  // ── PIN EMPLOYEE ──
  app.action('pin_employee', async ({ ack, body, client }) => {
    await ack();

    const [targetUserId] = body.actions[0].value.split(':');
    const teamId = getTeamId(body);

    await supabase.from('favorites').upsert({
      manager_user_id: body.user.id,
      favorite_user_id: targetUserId,
      team_id: teamId
    }, { onConflict: 'manager_user_id,favorite_user_id,team_id' });

    await publishHome(client, body.user.id, teamId, supabase, 'people');
  });

  // ── UNPIN EMPLOYEE ──
  app.action('unpin_employee', async ({ ack, body, client }) => {
    await ack();

    const [targetUserId, returnView] = body.actions[0].value.split(':');
    const teamId = getTeamId(body);

    await supabase.from('favorites')
      .delete()
      .eq('manager_user_id', body.user.id)
      .eq('favorite_user_id', targetUserId)
      .eq('team_id', teamId);

    await publishHome(client, body.user.id, teamId, supabase, returnView || 'people');
  });

  // ── VIEW PINNED TASKS (modal) ──
  app.action('view_pinned_tasks', async ({ ack, body, client }) => {
    await ack();

    const targetUserId = body.actions[0].value;
    const teamId = getTeamId(body);

    const openResult = await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Loading..." },
        close: { type: "plain_text", text: "Close" },
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "_Loading tasks..._" } }]
      }
    });

    const viewId = openResult?.view?.id;
    if (!viewId) {
      console.error('[view_pinned_tasks] Failed to open modal — no view ID returned');
      return;
    }

    try {
      const [
        { data: targetUser },
        taskBlocks
      ] = await Promise.all([
        supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
        buildPersonTasksBlocks(targetUserId, teamId, supabase)
      ]);

      const name = (targetUser?.name || 'User').split(' ')[0];

      await client.views.update({
        view_id: viewId,
        view: {
          type: "modal",
          title: { type: "plain_text", text: `${name}'s Tasks` },
          close: { type: "plain_text", text: "Close" },
          private_metadata: JSON.stringify({ targetUserId, teamId }),
          blocks: taskBlocks.slice(0, 100)
        }
      });
    } catch (err) {
      console.error('[view_pinned_tasks] Failed to load tasks:', err?.message || err, err?.data || '');
      await client.views.update({
        view_id: viewId,
        view: {
          type: "modal",
          title: { type: "plain_text", text: "Error" },
          close: { type: "plain_text", text: "Close" },
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "_Failed to load tasks. Please try again._" } }]
        }
      }).catch(() => {});
    }
  });
}


module.exports = { registerHandlers, syncUsersBackground };
