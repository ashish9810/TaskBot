const { matchTasksFromReply } = require('./parse-tasks');

// In-memory state for active standup conversations
// Key: slack_user_id, Value: { tasks, todoTasks, teamId, state, selectedTaskIds, expiresAt }
const activeStandups = new Map();

// Auto-expire stale standups every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of activeStandups) {
    if (now > data.expiresAt) {
      activeStandups.delete(userId);
    }
  }
}, 5 * 60 * 1000);

/**
 * Send the daily standup nudge DM to a user.
 * @param {string} type - 'morning' or 'evening'
 *   morning: Shows To Do + In Progress, asks what to work on
 *   evening: Shows only In Progress, asks to mark done or update
 */
async function sendStandupNudge(client, userId, teamId, supabase, type = 'morning') {
  // Fetch user's To Do and In Progress tasks
  const { data: allTasks } = await supabase
    .from('tasks')
    .select('id, title, status')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .in('status', ['active', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (!allTasks || allTasks.length === 0) return;

  const todoTasks = allTasks.filter(t => t.status === 'active');
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
  const webUrl = process.env.WEB_URL || 'http://localhost:3001';

  // ── EVENING: only show in-progress tasks, ask to mark done ──
  if (type === 'evening') {
    if (inProgressTasks.length === 0) return; // Nothing in progress, skip

    let index = 1;
    const numberedTasks = [];
    const inProgressSection = inProgressTasks.map(t => {
      const item = { index: index, title: t.title, id: t.id, status: 'in_progress' };
      numberedTasks.push(item);
      return `${index++}. ${t.title}`;
    });

    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ':city_sunset: *Evening check-in!*' }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You have *${inProgressTasks.length} task(s)* still in progress:\n${inProgressSection.join('\n')}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Any updates on these? You can:\n• Reply *"done 1"* to mark a task as complete\n• Reply *"done all"* to complete everything\n• Or update progress on the dashboard'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:link: <${webUrl}/dashboard|Click here to update on the dashboard>`
          }
        ]
      }
    ];

    try {
      await client.chat.postMessage({
        channel: userId,
        text: `Evening check-in! You have ${inProgressTasks.length} task(s) still in progress.`,
        blocks
      });

      // Set up standup state for "done" replies
      activeStandups.set(userId, {
        tasks: numberedTasks,
        todoTasks: numberedTasks, // for evening, all listed tasks can be marked done
        teamId,
        state: 'awaiting_selection',
        selectedTaskIds: [],
        actionType: 'complete', // evening = mark as done
        expiresAt: Date.now() + 30 * 60 * 1000
      });
    } catch (e) {
      console.error(`[standup] Failed to DM user ${userId}:`, e.message);
    }
    return;
  }

  // ── MORNING: show To Do + In Progress, ask what to work on ──
  let index = 1;
  const numberedTasks = [];

  const todoSection = todoTasks.map(t => {
    const item = { index: index, title: t.title, id: t.id, status: 'active' };
    numberedTasks.push(item);
    return `${index++}. ${t.title}`;
  });

  const inProgressSection = inProgressTasks.map(t => {
    const item = { index: index, title: t.title, id: t.id, status: 'in_progress' };
    numberedTasks.push(item);
    return `${index++}. ${t.title}`;
  });

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: ':sunrise: *Good morning!*' }
    }
  ];

  if (todoTasks.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clipboard: *To Do (${todoTasks.length} task${todoTasks.length > 1 ? 's' : ''}):*\n${todoSection.join('\n')}`
      }
    });
  }

  if (inProgressTasks.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:arrows_counterclockwise: *In Progress (${inProgressTasks.length} task${inProgressTasks.length > 1 ? 's' : ''}):*\n${inProgressSection.join('\n')}`
      }
    });
  }

  if (todoTasks.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'What are you planning to work on today?\nReply with task numbers (e.g. "1 and 3")'
      }
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "You're all caught up with tasks in progress! :rocket:"
      }
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:link: <${webUrl}/dashboard|Click here to update on the dashboard>`
      }
    ]
  });

  try {
    await client.chat.postMessage({
      channel: userId,
      text: `Good morning! You have ${todoTasks.length} tasks in To Do and ${inProgressTasks.length} in progress.`,
      blocks
    });

    if (todoTasks.length > 0) {
      activeStandups.set(userId, {
        tasks: numberedTasks,
        todoTasks: numberedTasks.filter(t => t.status === 'active'),
        teamId,
        state: 'awaiting_selection',
        selectedTaskIds: [],
        actionType: 'move', // morning = move to in progress
        expiresAt: Date.now() + 30 * 60 * 1000
      });
    }
  } catch (e) {
    console.error(`[standup] Failed to DM user ${userId}:`, e.message);
  }
}

/**
 * Handle a user's reply during an active standup conversation.
 * Routes based on conversation state.
 */
async function handleStandupReply(message, userId, say) {
  const standup = activeStandups.get(userId);
  if (!standup) return false;

  if (standup.state === 'awaiting_selection') {
    try {
      // Match reply to To Do tasks only (not in-progress ones)
      const selectedIndices = await matchTasksFromReply(message.text, standup.todoTasks);

      if (selectedIndices.length === 0) {
        await say({
          text: "I couldn't match any tasks from your reply. Try using task numbers (e.g. \"1 and 3\") or describe the tasks you want to work on.",
          channel: message.channel
        });
        return true;
      }

      const selectedTasks = selectedIndices
        .map(idx => standup.tasks.find(t => t.index === idx))
        .filter(Boolean);

      standup.selectedTaskIds = selectedTasks.map(t => t.id);
      standup.state = 'awaiting_confirmation';
      standup.expiresAt = Date.now() + 30 * 60 * 1000; // refresh timeout

      const taskList = selectedTasks.map(t => `- ${t.title}`).join('\n');
      const isEvening = standup.actionType === 'complete';
      const confirmText = isEvening
        ? `Marking these as *Done:*\n${taskList}`
        : `Got it! Moving these to *In Progress:*\n${taskList}`;

      await say({
        text: confirmText.replace(/\*/g, ''),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: confirmText
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: ':white_check_mark: Confirm' },
                style: 'primary',
                action_id: 'standup_confirm',
                value: userId
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: ':leftwards_arrow_with_hook: Go Back' },
                action_id: 'standup_go_back',
                value: userId
              }
            ]
          }
        ],
        channel: message.channel
      });
    } catch (err) {
      console.error('[standup] Error matching tasks:', err.message);
      await say({
        text: "Sorry, I had trouble understanding that. Try using task numbers (e.g. \"1 and 3\").",
        channel: message.channel
      });
    }
    return true;
  }

  // If in awaiting_confirmation, remind them to use the buttons
  if (standup.state === 'awaiting_confirmation') {
    await say({
      text: "Please use the Confirm or Go Back buttons above to proceed.",
      channel: message.channel
    });
    return true;
  }

  return false;
}

module.exports = { activeStandups, sendStandupNudge, handleStandupReply };
