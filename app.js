require('dotenv').config();

const { App, ExpressReceiver } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');

// =============================
// SUPABASE
// =============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =============================
// EXPRESS RECEIVER (for OAuth)
// =============================

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [
    'app_mentions:read',
    'channels:read',
    'chat:write',
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

function buildNavBar() {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "My Tasks" },
        action_id: "nav_my_tasks"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "People" },
        action_id: "nav_people"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📌 Pinned" },
        action_id: "nav_pinned"
      }
    ]
  };
}


// =============================
// SYNC USERS
// =============================

async function syncUsers(client, teamId) {
  const result = await client.users.list();

  for (const member of result.members) {
    if (member.is_bot || member.deleted) continue;

    await supabase.from('users').upsert({
      slack_user_id: member.id,
      team_id: teamId,
      name: member.real_name,
      email: member.profile.email
    }, { onConflict: 'slack_user_id,team_id' });
  }
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

  blocks.push(buildNavBar());
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

  const active    = (allTasks || []).filter(t => t.status === 'active');
  const completed = (allTasks || []).filter(t => t.status === 'completed')
                      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  const deleted   = (allTasks || []).filter(t => t.status === 'deleted')
                      .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

  let updatesByTaskId = {};
  for (const upd of (allUpdatesRaw || [])) {
    updatesByTaskId[upd.task_id] = (updatesByTaskId[upd.task_id] || 0) + 1;
  }

  // ── ACTIVE TASKS ──
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🔵 Active Tasks" }
  });

  if (!active || active.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No active tasks. Add one above!_" }
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
    text: { type: "plain_text", text: "✅ Completed Tasks" }
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

  // ── DELETED TASKS ──
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🗑 Deleted Tasks" }
  });

  if (!deleted || deleted.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No deleted tasks._" }
    });
  } else {
    for (const task of deleted) {
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${task.title}*` },
          { type: "mrkdwn", text: `🗑 Deleted: ${formatDate(task.deleted_at)}` }
        ]
      });
      blocks.push({ type: "divider" });
    }
  }

  return blocks;
}


async function buildPeopleView(userId, teamId, searchQuery = '') {
  let blocks = [];

  blocks.push(buildNavBar());
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

  for (const user of filtered) {
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

  return blocks;
}


async function buildPinnedView(userId, teamId) {
  let blocks = [];

  blocks.push(buildNavBar());
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
          { type: "mrkdwn", text: `*${task.title}*` },
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
          { type: "mrkdwn", text: `*${task.title}*` },
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

async function publishHome(client, userId, teamId, mode = 'my_tasks', searchQuery = '') {
  let blocks;

  if (mode === 'people') {
    blocks = await buildPeopleView(userId, teamId, searchQuery);
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
// HOME EVENT
// =============================

app.event('app_home_opened', async ({ event, client, body }) => {
  const teamId = getTeamId(body);
  syncUsersBackground(client, teamId);
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

  await supabase.from('tasks').insert({
    title,
    user_id: body.user.id,
    team_id: teamId,
    status: "active"
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

  const name = (targetUser?.name || 'User').substring(0, 18);

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
// DELETE TASK
// =============================

app.action('delete_task', async ({ ack, body, client }) => {
  await ack();

  await supabase.from('tasks').update({
    status: "deleted",
    deleted_at: new Date()
  }).eq('id', body.actions[0].value);

  await publishHome(client, body.user.id, getTeamId(body), 'my_tasks');
});


// =============================
// PEOPLE SEARCH
// =============================

app.action('people_search', async ({ ack, body, client }) => {
  await ack();
  const searchQuery = body.actions[0].value || '';
  await publishHome(client, body.user.id, getTeamId(body), 'people', searchQuery);
});


// =============================
// VIEW PERSON TASKS (modal)
// =============================

app.action('view_person_tasks', async ({ ack, body, client }) => {
  await ack();

  const targetUserId = body.actions[0].value;
  const teamId = getTeamId(body);

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
    buildPersonTasksBlocks(targetUserId, teamId)
  ]);

  const name = (targetUser?.name || 'User').substring(0, 18);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: `${name}'s Tasks` },
      close: { type: "plain_text", text: "Close" },
      private_metadata: JSON.stringify({ targetUserId, teamId }),
      blocks: taskBlocks
    }
  });
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

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).eq('team_id', teamId).single(),
    buildPersonTasksBlocks(targetUserId, teamId)
  ]);

  const name = (targetUser?.name || 'User').substring(0, 18);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: `${name}'s Tasks` },
      close: { type: "plain_text", text: "Close" },
      private_metadata: JSON.stringify({ targetUserId, teamId }),
      blocks: taskBlocks
    }
  });
});


// =============================
// START SERVER
// =============================

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡ TaskBot is live on port", process.env.PORT || 3000);
})();
