const cron = require('node-cron');
const { WebClient } = require('@slack/web-api');
const { sendStandupNudge } = require('./standup');

/**
 * Start the daily standup scheduler.
 * Runs weekday mornings at 9:00 AM UTC.
 * For each installed workspace, sends standup nudges to users with active tasks.
 */
function startStandupScheduler(app, supabase) {
  // Run at 9:00 AM UTC, Monday through Friday
  cron.schedule('0 9 * * 1-5', async () => {
    console.log('[scheduler] Running daily standup nudge...');

    try {
      // Get all installed workspaces
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

          // Find all users with To Do or In Progress tasks in this workspace
          const { data: userIds } = await supabase
            .from('tasks')
            .select('user_id')
            .eq('team_id', install.team_id)
            .in('status', ['active', 'in_progress']);

          if (!userIds || userIds.length === 0) continue;

          // Get unique user IDs
          const uniqueUserIds = [...new Set(userIds.map(r => r.user_id))];

          console.log(`[scheduler] Sending standups to ${uniqueUserIds.length} users in ${install.team_name}`);

          // Send nudge to each user (with small delay to avoid rate limits)
          for (const userId of uniqueUserIds) {
            await sendStandupNudge(client, userId, install.team_id, supabase);
            // Small delay between DMs to avoid Slack rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (teamErr) {
          console.error(`[scheduler] Error for team ${install.team_name}:`, teamErr.message);
        }
      }

      console.log('[scheduler] Daily standup complete.');
    } catch (err) {
      console.error('[scheduler] Fatal error:', err.message);
    }
  });

  console.log('[scheduler] Daily standup scheduler registered (9:00 AM UTC, weekdays)');
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
