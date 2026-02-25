require('dotenv').config();

const { App } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');


// =============================
// SUPABASE
// =============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);


// =============================
// SLACK APP
// =============================

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});


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

async function syncUsers(client) {
  const result = await client.users.list();

  for (const member of result.members) {
    if (member.is_bot || member.deleted) continue;

    await supabase.from('users').upsert({
      slack_user_id: member.id,
      name: member.real_name,
      email: member.profile.email
    });
  }
}

function syncUsersBackground(client) {
  syncUsers(client).catch(err =>
    console.error('syncUsers background error:', err)
  );
}


// =============================
// VIEW BUILDERS
// =============================

async function buildMyTasksView(userId) {
  let blocks = [];

  // Nav
  blocks.push(buildNavBar());
  blocks.push({ type: "divider" });

  // Add Task button
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

  // Fetch all tasks + all updates for this user in parallel (single round-trip pair)
  const [
    { data: allTasks },
    { data: allUpdatesRaw }
  ] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('updates').select('id, task_id').eq('user_id', userId)
  ]);

  const active    = (allTasks || []).filter(t => t.status === 'active');
  const completed = (allTasks || []).filter(t => t.status === 'completed')
                      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  const deleted   = (allTasks || []).filter(t => t.status === 'deleted')
                      .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

  // Build updates count map
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


async function buildPeopleView(userId, searchQuery = '') {
  let blocks = [];

  blocks.push(buildNavBar());
  blocks.push({ type: "divider" });

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "👥 People" }
  });

  // Search input
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

  // Fetch all users + current user's pins in parallel
  const [
    { data: allUsers },
    { data: pins }
  ] = await Promise.all([
    supabase.from('users').select('slack_user_id, name, email').order('name'),
    supabase.from('favorites').select('favorite_user_id').eq('manager_user_id', userId)
  ]);

  const pinnedIds = new Set((pins || []).map(p => p.favorite_user_id));

  // Filter by search query
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


async function buildPinnedView(userId) {
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
    .eq('manager_user_id', userId);

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


async function buildPersonTasksBlocks(targetUserId) {
  // Fetch all tasks + all updates for this person in parallel
  const [
    { data: allTasks },
    { data: allUpdatesRaw }
  ] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
    supabase.from('updates').select('id, task_id').eq('user_id', targetUserId)
  ]);

  const activeTasks    = (allTasks || []).filter(t => t.status === 'active');
  const completedTasks = (allTasks || []).filter(t => t.status === 'completed')
                           .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  // Build update count map
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

async function publishHome(client, userId, mode = 'my_tasks', searchQuery = '') {
  let blocks;

  if (mode === 'people') {
    blocks = await buildPeopleView(userId, searchQuery);
  } else if (mode === 'pinned') {
    blocks = await buildPinnedView(userId);
  } else {
    blocks = await buildMyTasksView(userId);
  }

  await client.views.publish({
    user_id: userId,
    view: { type: "home", blocks }
  });
}


// =============================
// HOME EVENT
// =============================

app.event('app_home_opened', async ({ event, client }) => {
  syncUsersBackground(client);
  await publishHome(client, event.user, 'my_tasks');
});


// =============================
// NAVIGATION
// =============================

app.action('nav_my_tasks', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'my_tasks');
});

app.action('nav_people', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'people');
});

app.action('nav_pinned', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'pinned');
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

  await supabase.from('tasks').insert({
    title,
    user_id: body.user.id,
    status: "active"
  });

  await publishHome(client, body.user.id, 'my_tasks');
});


// =============================
// UPDATE PROGRESS
// =============================

app.action('update_progress', async ({ ack, body, client }) => {
  await ack();

  const taskId = body.actions[0].value;

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "submit_update",
      private_metadata: taskId,
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

  await supabase.from('updates').insert({
    task_id: view.private_metadata,
    content: view.state.values.update.content.value,
    user_id: body.user.id
  });

  await publishHome(client, body.user.id, 'my_tasks');
});


// =============================
// VIEW UPDATES
// =============================

app.action('view_updates', async ({ ack, body, client }) => {
  await ack();

  const taskId = body.actions[0].value;
  const fromModal = body.view?.type === 'modal';

  // When triggered from a person's tasks modal, capture their userId so
  // the "← Back" button can navigate back to their tasks view.
  const parentUserId = fromModal
    ? (body.view.private_metadata || '')
    : '';

  const [
    { data: task },
    { data: updates }
  ] = await Promise.all([
    supabase.from('tasks').select('title, user_id').eq('id', taskId).single(),
    supabase.from('updates').select('*').eq('task_id', taskId).order('created_at', { ascending: false })
  ]);

  let blocks = [];

  // "← Back" button — only shown when opened from inside a person's tasks modal
  if (fromModal) {
    const backUserId = parentUserId || task?.user_id || '';
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "← Back" },
          value: backUserId,
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
    private_metadata: parentUserId,
    blocks
  };

  if (fromModal) {
    // Replace current modal in-place — avoids Slack's 3-level push stack limit
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

  const targetUserId = body.actions[0].value;

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).single(),
    buildPersonTasksBlocks(targetUserId)
  ]);

  const name = (targetUser?.name || 'User').substring(0, 18);

  await client.views.update({
    view_id: body.view.id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: `${name}'s Tasks` },
      private_metadata: targetUserId,
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

  await publishHome(client, body.user.id, 'my_tasks');
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

  await publishHome(client, body.user.id, 'my_tasks');
});


// =============================
// PEOPLE SEARCH
// =============================

app.action('people_search', async ({ ack, body, client }) => {
  await ack();
  const searchQuery = body.actions[0].value || '';
  await publishHome(client, body.user.id, 'people', searchQuery);
});


// =============================
// VIEW PERSON TASKS (modal)
// =============================

app.action('view_person_tasks', async ({ ack, body, client }) => {
  await ack();

  const targetUserId = body.actions[0].value;

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).single(),
    buildPersonTasksBlocks(targetUserId)
  ]);

  const name = (targetUser?.name || 'User').substring(0, 18);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: `${name}'s Tasks` },
      close: { type: "plain_text", text: "Close" },
      private_metadata: targetUserId,
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

  await supabase.from('favorites').upsert({
    manager_user_id: body.user.id,
    favorite_user_id: targetUserId
  });

  await publishHome(client, body.user.id, 'people');
});


// =============================
// UNPIN EMPLOYEE
// =============================

app.action('unpin_employee', async ({ ack, body, client }) => {
  await ack();

  const [targetUserId, returnView] = body.actions[0].value.split(':');

  await supabase.from('favorites')
    .delete()
    .eq('manager_user_id', body.user.id)
    .eq('favorite_user_id', targetUserId);

  await publishHome(client, body.user.id, returnView || 'people');
});


// =============================
// VIEW PINNED TASKS (modal)
// =============================

app.action('view_pinned_tasks', async ({ ack, body, client }) => {
  await ack();

  const targetUserId = body.actions[0].value;

  const [
    { data: targetUser },
    taskBlocks
  ] = await Promise.all([
    supabase.from('users').select('name').eq('slack_user_id', targetUserId).single(),
    buildPersonTasksBlocks(targetUserId)
  ]);

  const name = (targetUser?.name || 'User').substring(0, 18);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: `${name}'s Tasks` },
      close: { type: "plain_text", text: "Close" },
      private_metadata: targetUserId,
      blocks: taskBlocks
    }
  });
});


// =============================
// START SERVER
// =============================

(async () => {
  await app.start(3000);
  console.log("⚡ TaskBot is live on port 3000");
})();
