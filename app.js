require('dotenv').config();

const { App, ExpressReceiver } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');
const { parseTasks } = require('./lib/parse-tasks');
const { activeStandups, handleStandupReply } = require('./lib/standup');
const { startStandupScheduler, triggerStandupForUser } = require('./lib/scheduler');
const { understandIntent, buildTaskListMessage, buildSummaryMessage, STATUS_LABELS, UNKNOWN_RESPONSE } = require('./lib/conversation');

// =============================
// SUPABASE
// =============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// In-memory state for bulk task creation confirmations
const pendingBulkCreations = new Map(); // userId -> { tasks, teamId, timestamp }

// In-memory conversation context for DM assistant
// Stores recently shown numbered lists so the bot can reference them
const dmContext = new Map(); // userId -> { recentList, teamId, pendingAction, timestamp }

// Auto-expire stale states every minute
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of pendingBulkCreations) {
    if (now - data.timestamp > 5 * 60 * 1000) pendingBulkCreations.delete(userId);
  }
  for (const [userId, data] of dmContext) {
    if (now - data.timestamp > 15 * 60 * 1000) dmContext.delete(userId);
  }
}, 60 * 1000);

// Helper: look up workspace_id for a given Slack team_id
async function getWorkspaceId(teamId) {
  const { data } = await supabase
    .from('workspaces')
    .select('id')
    .eq('slack_team_id', teamId)
    .single();
  return data?.id || null;
}

// =============================
// EXPRESS RECEIVER (for OAuth)
// =============================

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  installerOptions: {
    stateVerification: false,
    callbackOptions: {
      success: (installation, _options, _req, res) => {
        const teamId = installation.team?.id || installation.enterprise?.id || '';
        const webUrl = process.env.WEB_URL || 'http://localhost:3001';
        res.redirect(`${webUrl}/api/slack/callback?team_id=${teamId}`);
      },
      failure: (_error, _options, _req, res) => {
        const webUrlFail = process.env.WEB_URL || 'http://localhost:3001';
        res.redirect(`${webUrlFail}/dashboard`);
      }
    }
  },
  scopes: [
    'app_mentions:read',
    'channels:read',
    'chat:write',
    'im:history',
    'im:read',
    'im:write',
    'users:read',
    'users:read.email',
  ],
  installationStore: {
    storeInstallation: async (installation) => {
      const teamId = installation.isEnterpriseInstall
        ? installation.enterprise.id
        : installation.team.id;
      const teamName = installation.isEnterpriseInstall
        ? installation.enterprise.name
        : installation.team.name;

      await supabase.from('installations').upsert({
        team_id: teamId,
        team_name: teamName,
        bot_token: installation.bot.token,
        bot_id: installation.bot.id,
        bot_user_id: installation.bot.userId,
        installed_at: new Date().toISOString()
      }, { onConflict: 'team_id' });

      console.log(`✅ Installed for workspace: ${teamName} (${teamId})`);

      const { WebClient } = require('@slack/web-api');
      const client = new WebClient(installation.bot.token);

      // Sync all workspace users in background (avoids rate-limit timeout blocking install)
      syncUsersBackground(client, teamId);

      // Send welcome DM (optional — ignore if messages tab is disabled)
      try {
        await client.chat.postMessage({
          channel: installation.user.id,
          text: `👋 *Welcome to Ping!*\n\nPing helps you track tasks and monitor your team — right inside Slack.\n\n*Get started:*\n• Open the <slack://app?team=${teamId}&id=${installation.bot.id}&tab=home|Ping Home tab> to manage tasks\n• Use *My Tasks* to see your work\n• Use *People* to assign tasks to teammates\n• Use *📌 Pinned* to track key people\n\nYou're all set! 🚀`
        });
      } catch (e) {
        console.error('Welcome DM failed (non-fatal):', e.message);
      }
    },
    fetchInstallation: async (installQuery) => {
      const teamId = installQuery.isEnterpriseInstall
        ? installQuery.enterpriseId
        : installQuery.teamId;

      const { data, error } = await supabase
        .from('installations')
        .select('*')
        .eq('team_id', teamId)
        .single();

      if (error || !data) throw new Error(`No installation found for team ${teamId}`);

      return {
        bot: {
          token: data.bot_token,
          id: data.bot_id,
          userId: data.bot_user_id
        },
        team: { id: teamId, name: data.team_name },
        isEnterpriseInstall: false
      };
    },
    deleteInstallation: async (installQuery) => {
      const teamId = installQuery.isEnterpriseInstall
        ? installQuery.enterpriseId
        : installQuery.teamId;
      await supabase.from('installations').delete().eq('team_id', teamId);
    }
  }
});

// =============================
// SLACK APP
// =============================

const app = new App({ receiver });

receiver.router.get('/health', (_req, res) => res.status(200).send('OK'));

receiver.router.get('/sync-users', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.SYNC_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { data: installations, error } = await supabase.from('installations').select('team_id, bot_token, team_name');
  if (error) return res.status(500).send('Failed to fetch installations: ' + error.message);

  res.json({ message: `Syncing ${installations.length} workspace(s) in background...`, workspaces: installations.map(i => i.team_name) });

  const { WebClient } = require('@slack/web-api');
  for (const install of installations) {
    const client = new WebClient(install.bot_token);
    syncUsersBackground(client, install.team_id);
  }
});

// Helper to get team_id from body
function getTeamId(body) {
  return body.team_id || body.team?.id || '';
}

// =============================
// HELPERS
// =============================

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
      btn("People", "nav_people", "people"),
      btn("📌 Pinned", "nav_pinned", "pinned")
    ]
  };
}


// =============================
// SYNC USERS
// =============================

async function syncUsers(client, teamId) {
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

function syncUsersBackground(client, teamId) {
  syncUsers(client, teamId).catch(err =>
    console.error('syncUsers background error:', err)
  );
}


// =============================
// VIEW BUILDERS
// =============================

async function buildMyTasksView(userId, teamId) {
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

  const backlog    = (allTasks || []).filter(t => t.status === 'backlog');
  const active     = (allTasks || []).filter(t => t.status === 'active');
  const inProgress = (allTasks || []).filter(t => t.status === 'in_progress');
  const completed  = (allTasks || []).filter(t => t.status === 'completed')
                       .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  let updatesByTaskId = {};
  for (const upd of (allUpdatesRaw || [])) {
    updatesByTaskId[upd.task_id] = (updatesByTaskId[upd.task_id] || 0) + 1;
  }

  // ── INBOX (assigned by others) ──
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
    for (const task of backlog) {
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
  }

  // ── TO DO ──
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
    for (const task of active) {
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
  }

  // ── IN PROGRESS ──
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
    for (const task of inProgress) {
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
  }

  // ── COMPLETED TASKS ──
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
    for (const task of completed) {
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
  }

  return blocks;
}


const PEOPLE_PAGE_SIZE = 20;

async function buildPeopleView(userId, teamId, searchQuery = '', page = 0) {
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

  // Pagination buttons
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


async function buildPinnedView(userId, teamId) {
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


async function buildPersonTasksBlocks(targetUserId, teamId) {
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

async function publishHome(client, userId, teamId, mode = 'my_tasks', searchQuery = '', page = 0) {
  let blocks;

  if (mode === 'people') {
    blocks = await buildPeopleView(userId, teamId, searchQuery, page);
  } else if (mode === 'pinned') {
    blocks = await buildPinnedView(userId, teamId);
  } else {
    blocks = await buildMyTasksView(userId, teamId);
  }

  await client.views.publish({
    user_id: userId,
    view: { type: "home", blocks }
  });
}


// =============================
// APP MENTION — assign task via @Ping or natural language task creation
// Usage: @Ping assign @John fix the login bug
//    OR: @Ping create these tasks: PRD for payments, send report to manager
// =============================

app.event('app_mention', async ({ event, client, body }) => {
  const teamId = getTeamId(body);
  const botUserId = body.authorizations?.[0]?.user_id || '';

  // Keep the raw text for extracting @mentions, strip mentions for AI parsing
  const rawText = event.text;
  const text = rawText.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!text) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `Hi <@${event.user}>! Here's how to use Ping:\n• *@Ping assign @John fix the login bug, send report, review Q1* — assign tasks to others or yourself\n• *@Ping create PRD for payments, send report to manager* — create tasks for yourself`
    });
    return;
  }

  try {
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: 'hourglass_flowing_sand'
    }).catch(() => {});

    // Extract @mentioned users (excluding the bot and the sender)
    const mentionMatches = rawText.match(/<@([A-Z0-9]+)>/g) || [];
    const mentionedUserIds = mentionMatches
      .map(m => m.replace(/<@|>/g, ''))
      .filter(id => id !== botUserId && id !== event.user);

    // Look up mentioned users' names from DB
    let mentionedUsers = [];
    if (mentionedUserIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('slack_user_id, name')
        .eq('team_id', teamId)
        .in('slack_user_id', mentionedUserIds);
      mentionedUsers = users || [];
    }

    // Build name-to-SlackID map for assignee resolution
    const memberNames = mentionedUsers.map(u => u.name);
    const nameToSlackId = {};
    for (const u of mentionedUsers) {
      nameToSlackId[u.name.toLowerCase()] = u.slack_user_id;
      const firstName = u.name.split(' ')[0].toLowerCase();
      nameToSlackId[firstName] = u.slack_user_id;
    }

    // If only one person is mentioned and text says "assign", all tasks go to that person
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

    // Resolve assignees: global assign > per-task hint > self
    for (const task of tasks) {
      if (globalAssigneeId) {
        // "assign @John task1, task2, task3" → all go to John
        task.assignee_slack_id = globalAssigneeId;
      } else if (task.assignee_hint && task.assignee_hint !== 'me') {
        const hint = task.assignee_hint.toLowerCase();
        task.assignee_slack_id = nameToSlackId[hint] || null;
      } else {
        task.assignee_slack_id = null; // defaults to self
      }
    }

    // Store pending tasks
    pendingBulkCreations.set(event.user, {
      tasks,
      teamId,
      channelId: event.channel,
      threadTs: event.ts,
      mentionedUsers,
      timestamp: Date.now()
    });

    // Build checkbox labels showing assignee
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


// =============================
// DM MESSAGE — Conversational AI Assistant
// =============================

// Helper: fetch user's tasks grouped by status
async function getUserTaskContext(userId, teamId) {
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

app.message(async ({ message, client, say }) => {
  // Ignore bot messages, message edits, and non-DM messages
  if (message.subtype || message.bot_id) return;
  if (message.channel_type !== 'im') return;

  const userId = message.user;
  const text = (message.text || '').trim();
  if (!text) return;

  // Look up team_id for this user
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

  // Check if user is in an active standup conversation
  if (activeStandups.has(userId)) {
    const handled = await handleStandupReply(message, userId, say);
    if (handled) return;
  }

  // Show instant thinking indicator so user knows bot received their message
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

  // Helper to remove thinking indicator
  const removeThinking = async () => {
    if (thinkingTs) {
      try {
        await client.chat.delete({ channel: message.channel, ts: thinkingTs });
      } catch (e) {
        // If delete fails, try updating it to empty
        try {
          await client.chat.update({ channel: message.channel, ts: thinkingTs, text: ' ' });
        } catch {}
      }
      thinkingTs = null;
    }
  };

  try {
    // Get the user's current tasks for context
    const taskContext = await getUserTaskContext(userId, teamId);
    const ctx = dmContext.get(userId) || null;
    const recentList = ctx?.recentList || null;

    // Understand what the user wants
    const intent = await understandIntent(text, taskContext, recentList);
    console.log('[DM] Intent:', JSON.stringify(intent));

    // Remove thinking indicator before sending actual response
    await removeThinking();

    // ── UNKNOWN ──
    if (intent.intent === 'unknown') {
      await say(UNKNOWN_RESPONSE);
      return;
    }

    // ── SUMMARY ──
    if (intent.intent === 'summary') {
      const summary = buildSummaryMessage(taskContext);
      await say(summary);
      return;
    }

    // ── VIEW ──
    if (intent.intent === 'view') {
      const status = intent.sourceStatus || 'active';
      const tasks = taskContext[status] || [];
      const label = STATUS_LABELS[status] || status;
      const { text: listText, numberedTasks } = buildTaskListMessage(tasks, label);

      // Save context for follow-up
      dmContext.set(userId, { recentList: numberedTasks, teamId, timestamp: Date.now() });

      await say(listText + '\n\nYou can say things like _"move 1, 3 to in progress"_ or _"delete 2"_.');
      return;
    }

    // ── CREATE ──
    if (intent.intent === 'create' && intent.createTasks && intent.createTasks.length > 0) {
      const workspaceId = await getWorkspaceId(teamId);
      const tasks = intent.createTasks;

      // Store pending for confirmation
      pendingBulkCreations.set(userId, {
        tasks,
        teamId,
        timestamp: Date.now()
      });

      const checkboxOptions = tasks.map((task, i) => ({
        text: { type: 'plain_text', text: task.title.substring(0, 75) },
        value: String(i)
      }));

      await say({
        text: `I found ${tasks.length} task(s) to create:`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `:clipboard: I found *${tasks.length} task(s)* to create:` }
          },
          {
            type: 'actions',
            block_id: 'bulk_task_checkboxes',
            elements: [{
              type: 'checkboxes',
              action_id: 'bulk_task_selection',
              initial_options: checkboxOptions,
              options: checkboxOptions
            }]
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: ':white_check_mark: Create Selected' },
                style: 'primary',
                action_id: 'bulk_create_confirm',
                value: userId
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: ':x: Cancel' },
                action_id: 'bulk_create_cancel',
                value: userId
              }
            ]
          }
        ]
      });
      return;
    }

    // ── MOVE ──
    if (intent.intent === 'move') {
      const targetStatus = intent.targetStatus;
      const targetLabel = STATUS_LABELS[targetStatus] || targetStatus;

      // If user referenced specific numbers AND we have a recent list, use it
      if (intent.taskIndices && intent.taskIndices.length > 0 && recentList && recentList.length > 0) {
        const selectedTasks = intent.taskIndices
          .map(idx => recentList.find(t => t.index === idx))
          .filter(Boolean);

        if (selectedTasks.length > 0) {
          // Store pending action for confirmation
          dmContext.set(userId, {
            recentList,
            teamId,
            pendingAction: { type: 'move', tasks: selectedTasks, targetStatus },
            timestamp: Date.now()
          });

          const taskList = selectedTasks.map(t => `• ${t.title}`).join('\n');
          await say({
            text: `Moving to ${targetLabel}:\n${taskList}`,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `Moving these to *${targetLabel}*:\n${taskList}` }
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: ':white_check_mark: Confirm' },
                    style: 'primary',
                    action_id: 'dm_action_confirm',
                    value: userId
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: ':x: Cancel' },
                    action_id: 'dm_action_cancel',
                    value: userId
                  }
                ]
              }
            ]
          });
          return;
        }
      }

      // Otherwise show the list and ask user to pick
      const sourceStatus = intent.sourceStatus || (targetStatus === 'in_progress' ? 'active' : targetStatus === 'completed' ? 'in_progress' : 'active');
      const sourceLabel = STATUS_LABELS[sourceStatus] || sourceStatus;
      const tasks = taskContext[sourceStatus] || [];
      const { text: listText, numberedTasks } = buildTaskListMessage(tasks, sourceLabel);

      // Save context
      dmContext.set(userId, {
        recentList: numberedTasks,
        teamId,
        pendingAction: { type: 'move', targetStatus },
        timestamp: Date.now()
      });

      if (tasks.length === 0) {
        await say(`You have no tasks in *${sourceLabel}* to move.`);
        return;
      }

      await say(listText + `\n\nWhich task(s) do you want to move to *${targetLabel}*? Reply with the numbers (e.g. "1, 3, 4").`);
      return;
    }

    // ── DELETE ──
    if (intent.intent === 'delete') {
      // If "delete all" for a status
      if (intent.scope === 'all' && intent.sourceStatus) {
        const sourceLabel = STATUS_LABELS[intent.sourceStatus] || intent.sourceStatus;
        const tasks = taskContext[intent.sourceStatus] || [];

        if (tasks.length === 0) {
          await say(`You have no tasks in *${sourceLabel}* to delete.`);
          return;
        }

        const numberedTasks = tasks.map((t, i) => ({ index: i + 1, id: t.id, title: t.title, status: t.status }));

        dmContext.set(userId, {
          recentList: numberedTasks,
          teamId,
          pendingAction: { type: 'delete', tasks: numberedTasks, scope: 'all' },
          timestamp: Date.now()
        });

        await say({
          text: `Delete all ${tasks.length} tasks in ${sourceLabel}?`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `:warning: You have *${tasks.length} task(s)* in *${sourceLabel}*. Are you sure you want to delete *all* of them?` }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: ':wastebasket: Yes, delete all' },
                  style: 'danger',
                  action_id: 'dm_action_confirm',
                  value: userId
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: ':x: Cancel' },
                  action_id: 'dm_action_cancel',
                  value: userId
                }
              ]
            }
          ]
        });
        return;
      }

      // If user has specific numbers from a recent list
      if (intent.taskIndices && intent.taskIndices.length > 0 && recentList && recentList.length > 0) {
        const selectedTasks = intent.taskIndices
          .map(idx => recentList.find(t => t.index === idx))
          .filter(Boolean);

        if (selectedTasks.length > 0) {
          dmContext.set(userId, {
            recentList,
            teamId,
            pendingAction: { type: 'delete', tasks: selectedTasks },
            timestamp: Date.now()
          });

          const taskList = selectedTasks.map(t => `• ${t.title}`).join('\n');
          await say({
            text: `Delete these tasks?\n${taskList}`,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `:warning: Delete these task(s)?\n${taskList}` }
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: ':wastebasket: Yes, delete' },
                    style: 'danger',
                    action_id: 'dm_action_confirm',
                    value: userId
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: ':x: Cancel' },
                    action_id: 'dm_action_cancel',
                    value: userId
                  }
                ]
              }
            ]
          });
          return;
        }
      }

      // Show list and ask which to delete
      const sourceStatus = intent.sourceStatus || 'active';
      const sourceLabel = STATUS_LABELS[sourceStatus] || sourceStatus;
      const tasks = taskContext[sourceStatus] || [];
      const { text: listText, numberedTasks } = buildTaskListMessage(tasks, sourceLabel);

      dmContext.set(userId, {
        recentList: numberedTasks,
        teamId,
        pendingAction: { type: 'delete' },
        timestamp: Date.now()
      });

      if (tasks.length === 0) {
        await say(`You have no tasks in *${sourceLabel}* to delete.`);
        return;
      }

      await say(listText + '\n\nWhich task(s) do you want to delete? Reply with the numbers (e.g. "2, 4").');
      return;
    }

    // ── FOLLOW-UP: User is replying with numbers to a previous list ──
    // If we have a pending action and the user sent numbers
    if (ctx?.pendingAction && recentList && recentList.length > 0) {
      const numbers = text.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        const indices = numbers.map(n => parseInt(n)).filter(n => n >= 1 && n <= recentList.length);
        const selectedTasks = indices.map(idx => recentList.find(t => t.index === idx)).filter(Boolean);

        if (selectedTasks.length > 0) {
          const action = ctx.pendingAction;

          if (action.type === 'move') {
            const targetLabel = STATUS_LABELS[action.targetStatus] || action.targetStatus;

            dmContext.set(userId, {
              ...ctx,
              pendingAction: { ...action, tasks: selectedTasks },
              timestamp: Date.now()
            });

            const taskList = selectedTasks.map(t => `• ${t.title}`).join('\n');
            await say({
              text: `Moving to ${targetLabel}:\n${taskList}`,
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `Moving these to *${targetLabel}*:\n${taskList}` }
                },
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':white_check_mark: Confirm' },
                      style: 'primary',
                      action_id: 'dm_action_confirm',
                      value: userId
                    },
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':x: Cancel' },
                      action_id: 'dm_action_cancel',
                      value: userId
                    }
                  ]
                }
              ]
            });
            return;
          }

          if (action.type === 'delete') {
            dmContext.set(userId, {
              ...ctx,
              pendingAction: { ...action, tasks: selectedTasks },
              timestamp: Date.now()
            });

            const taskList = selectedTasks.map(t => `• ${t.title}`).join('\n');
            await say({
              text: `Delete these?\n${taskList}`,
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `:warning: Delete these task(s)?\n${taskList}` }
                },
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':wastebasket: Yes, delete' },
                      style: 'danger',
                      action_id: 'dm_action_confirm',
                      value: userId
                    },
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: ':x: Cancel' },
                      action_id: 'dm_action_cancel',
                      value: userId
                    }
                  ]
                }
              ]
            });
            return;
          }
        }
      }
    }

    // Fallback
    await say(UNKNOWN_RESPONSE);

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

// =============================
// DM ACTION — confirm / cancel (for move, delete)
// =============================

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

      // Refresh Home Tab
      try { await publishHome(client, userId, ctx.teamId, 'my_tasks'); } catch (e) {}
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

      // Refresh Home Tab
      try { await publishHome(client, userId, ctx.teamId, 'my_tasks'); } catch (e) {}
    }

    // Clear the pending action but keep the context
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

// Bulk create — confirm
app.action('bulk_create_confirm', async ({ ack, body, client }) => {
  await ack();

  try {
  const userId = body.user.id;
  const channelId = body.channel?.id || body.container?.channel_id || body.user.id;
  const messageTs = body.message?.ts || body.container?.message_ts;
  console.log('[bulk_create_confirm] userId:', userId, 'channelId:', channelId, 'messageTs:', messageTs);
  const pending = pendingBulkCreations.get(userId);

  if (!pending) {
    await client.chat.postMessage({
      channel: channelId,
      text: "This request has expired. Please send your tasks again."
    });
    return;
  }

  // Get selected checkboxes from Slack state
  let selectedIndices = [];
  const checkboxState = body.state?.values?.bulk_task_checkboxes?.bulk_task_selection?.selected_options;
  if (checkboxState && checkboxState.length > 0) {
    selectedIndices = checkboxState.map(opt => parseInt(opt.value));
  }

  // If we couldn't read the state, create all tasks
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

  // Create tasks in Supabase — assign to the right person
  const workspaceId = await getWorkspaceId(pending.teamId);
  let created = 0;
  const assignedToOthers = []; // track tasks assigned to others for DM notifications

  for (const task of selectedTasks) {
    const assigneeId = task.assignee_slack_id || userId; // default to self
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

  // DM users who got assigned tasks
  for (const assigned of assignedToOthers) {
    try {
      const webUrl = process.env.WEB_URL || 'http://localhost:3001';
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

  // Refresh Home Tab
  try {
    await publishHome(client, userId, pending.teamId, 'my_tasks');
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


// =============================
// STANDUP — confirm / go back
// =============================

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

  // Refresh Home Tab
  try {
    await publishHome(client, userId, standup.teamId, 'my_tasks');
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

  // Reset to awaiting_selection
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


// =============================
// HOME EVENT
// =============================

app.event('app_home_opened', async ({ event, client, body }) => {
  const teamId = getTeamId(body);

  // Only sync if this user is not yet in the database (avoids rate limiting)
  const { data: existingUser } = await supabase
    .from('users')
    .select('slack_user_id')
    .eq('slack_user_id', event.user)
    .eq('team_id', teamId)
    .single();

  if (!existingUser) syncUsersBackground(client, teamId);

  await publishHome(client, event.user, teamId, 'my_tasks');
});


// =============================
// NAVIGATION
// =============================

app.action('nav_my_tasks', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});

app.action('nav_people', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, getTeamId(body), 'people');
});

app.action('nav_pinned', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, getTeamId(body), 'pinned');
});


// =============================
// ADD TASK
// =============================

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

  const workspaceId = await getWorkspaceId(teamId);
  await supabase.from('tasks').insert({
    title,
    user_id: body.user.id,
    team_id: teamId,
    status: "active",
    ...(workspaceId ? { workspace_id: workspaceId } : {})
  });

  await publishHome(client, body.user.id, teamId, 'my_tasks');
});


// =============================
// UPDATE PROGRESS
// =============================

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

  await publishHome(client, body.user.id, teamId, 'my_tasks');
});


// =============================
// VIEW UPDATES
// =============================

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


// =============================
// BACK TO PERSON TASKS
// =============================

app.action('back_to_person_tasks', async ({ ack, body, client }) => {
  await ack();

  const { targetUserId, teamId } = JSON.parse(body.actions[0].value);

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
    buildPersonTasksBlocks(targetUserId, teamId)
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


// =============================
// COMPLETE TASK
// =============================

app.action('complete_task', async ({ ack, body, client }) => {
  await ack();

  await supabase.from('tasks').update({
    status: "completed",
    completed_at: new Date()
  }).eq('id', body.actions[0].value);

  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});


// =============================
// BACKLOG TO TODO
// =============================

app.action('backlog_to_todo', async ({ ack, body, client }) => {
  await ack();

  await supabase.from('tasks').update({
    status: "active"
  }).eq('id', body.actions[0].value);

  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});


// =============================
// IN PROGRESS TASK
// =============================

app.action('inprogress_task', async ({ ack, body, client }) => {
  await ack();

  await supabase.from('tasks').update({
    status: "in_progress"
  }).eq('id', body.actions[0].value);

  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});


// =============================
// DELETE TASK (permanent)
// =============================

app.action('delete_task', async ({ ack, body, client }) => {
  await ack();

  const taskId = body.actions[0].value;
  await supabase.from('updates').delete().eq('task_id', taskId);
  await supabase.from('tasks').delete().eq('id', taskId);

  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});


// =============================
// PEOPLE SEARCH
// =============================

app.action('people_search', async ({ ack, body, client }) => {
  await ack();
  const searchQuery = body.actions[0].value || '';
  await publishHome(client, body.user.id, getTeamId(body), 'people', searchQuery, 0);
});

app.action('people_prev_page', async ({ ack, body, client }) => {
  await ack();
  const [pageStr, ...rest] = (body.actions[0].value || '0:').split(':');
  const searchQuery = rest.join(':');
  await publishHome(client, body.user.id, getTeamId(body), 'people', searchQuery, parseInt(pageStr));
});

app.action('people_next_page', async ({ ack, body, client }) => {
  await ack();
  const [pageStr, ...rest] = (body.actions[0].value || '0:').split(':');
  const searchQuery = rest.join(':');
  await publishHome(client, body.user.id, getTeamId(body), 'people', searchQuery, parseInt(pageStr));
});


// =============================
// VIEW PERSON TASKS (modal)
// =============================

app.action('view_person_tasks', async ({ ack, body, client }) => {
  await ack();

  const targetUserId = body.actions[0].value;
  const teamId = getTeamId(body);

  // Open modal immediately before any async work so trigger_id doesn't expire
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
      buildPersonTasksBlocks(targetUserId, teamId)
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


// =============================
// PIN EMPLOYEE
// =============================

app.action('pin_employee', async ({ ack, body, client }) => {
  await ack();

  const [targetUserId] = body.actions[0].value.split(':');
  const teamId = getTeamId(body);

  await supabase.from('favorites').upsert({
    manager_user_id: body.user.id,
    favorite_user_id: targetUserId,
    team_id: teamId
  }, { onConflict: 'manager_user_id,favorite_user_id,team_id' });

  await publishHome(client, body.user.id, teamId, 'people');
});


// =============================
// UNPIN EMPLOYEE
// =============================

app.action('unpin_employee', async ({ ack, body, client }) => {
  await ack();

  const [targetUserId, returnView] = body.actions[0].value.split(':');
  const teamId = getTeamId(body);

  await supabase.from('favorites')
    .delete()
    .eq('manager_user_id', body.user.id)
    .eq('favorite_user_id', targetUserId)
    .eq('team_id', teamId);

  await publishHome(client, body.user.id, teamId, returnView || 'people');
});


// =============================
// VIEW PINNED TASKS (modal)
// =============================

app.action('view_pinned_tasks', async ({ ack, body, client }) => {
  await ack();

  const targetUserId = body.actions[0].value;
  const teamId = getTeamId(body);

  // Open modal immediately before any async work so trigger_id doesn't expire
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
      buildPersonTasksBlocks(targetUserId, teamId)
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


// =============================
// TEST ROUTE — manually trigger standup (for local testing)
// Usage: GET /test-standup?user=U12345&team=T12345&secret=dream-dr54rtd7-s3cr3t-k3y-X9mQ2pL7vR
// =============================

receiver.router.get('/test-standup', async (req, res) => {
  const { user, team, secret } = req.query;
  if (secret !== process.env.SLACK_STATE_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  if (!user || !team) {
    return res.status(400).send('Missing user or team query params');
  }

  try {
    // Look up the bot token for this team
    const { data: install } = await supabase
      .from('installations')
      .select('bot_token')
      .eq('team_id', team)
      .single();

    if (!install) return res.status(404).send('No installation found for this team');

    const { WebClient } = require('@slack/web-api');
    const client = new WebClient(install.bot_token);

    await triggerStandupForUser(client, user, team, supabase);
    res.send(`Standup nudge sent to user ${user}`);
  } catch (err) {
    console.error('[test-standup] Error:', err.message);
    res.status(500).send('Error: ' + err.message);
  }
});


// =============================
// START SERVER
// =============================

(async () => {
  await app.start(process.env.PORT || 3000);
  startStandupScheduler(app, supabase);
  console.log("⚡ TaskBot is live on port", process.env.PORT || 3000);
})();
