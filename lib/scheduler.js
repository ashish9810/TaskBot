const cron = require('node-cron');
const { WebClient } = require('@slack/web-api');
const { sendStandupNudge } = require('./standup');

/**
 * Start the daily standup scheduler.
 * Sends standup nudges twice a day (weekdays):
 *   1. 10:30 AM IST (5:00 AM UTC) — morning planning
 *   2. 6:00 PM IST (12:30 PM UTC) — evening wrap-up
 */
function startStandupScheduler(app, supabase) {

  async function runStandup(label) {
    console.log(`[scheduler] Running ${label} standup nudge...`);

    try {
      const { data: installations, error } = await supabase
        .from('installations')
        .select('team_id, bot_token, team_name');

      if (error || !installations || installations.length === 0) {
        console.log('[scheduler] No installations found, skipping.');
        return;
      }

      for (const install of installations) {
        try {
          const client = new WebClient(install.bot_token);

          const { data: userIds } = await supabase
            .from('tasks')
            .select('user_id')
            .eq('team_id', install.team_id)
            .in('status', ['active', 'in_progress']);

          if (!userIds || userIds.length === 0) continue;

          const uniqueUserIds = [...new Set(userIds.map(r => r.user_id))];

          console.log(`[scheduler] Sending ${label} standups to ${uniqueUserIds.length} users in ${install.team_name}`);

          for (const userId of uniqueUserIds) {
            await sendStandupNudge(client, userId, install.team_id, supabase, label);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (teamErr) {
          console.error(`[scheduler] Error for team ${install.team_name}:`, teamErr.message);
        }
      }

      console.log(`[scheduler] ${label} standup complete.`);
    } catch (err) {
      console.error('[scheduler] Fatal error:', err.message);
    }
  }

  // 10:30 AM IST = 5:00 AM UTC, weekdays
  cron.schedule('0 5 * * 1-5', () => runStandup('morning'));

  // 6:00 PM IST = 12:30 PM UTC, weekdays
  cron.schedule('30 12 * * 1-5', () => runStandup('evening'));

  console.log('[scheduler] Standup scheduler registered — 10:30 AM IST & 6:00 PM IST, weekdays');
}

/**
 * Manually trigger standup for a specific user (for testing).
 * Call this from a test route or console.
 */
async function triggerStandupForUser(client, userId, teamId, supabase) {
  console.log(`[scheduler] Manually triggering standup for user ${userId}`);
  await sendStandupNudge(client, userId, teamId, supabase);
}

module.exports = { startStandupScheduler, triggerStandupForUser };
