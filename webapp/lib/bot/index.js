const { App, ExpressReceiver } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');
const { startStandupScheduler, triggerStandupForUser } = require('./scheduler');
const { registerHandlers } = require('./handlers');

function initBot() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // In-memory state for bulk task creation confirmations
  const pendingBulkCreations = new Map(); // userId -> { tasks, teamId, timestamp }

  // In-memory conversation context for DM assistant
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

  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.SLACK_STATE_SECRET,
    installerOptions: {
      callbackOptions: {
        success: (installation, _options, _req, res) => {
          const teamId = installation.team?.id || installation.enterprise?.id || '';
          res.redirect(`/api/slack/callback?team_id=${teamId}`);
        },
        failure: (_error, _options, _req, res) => {
          res.redirect('/dashboard');
        }
      }
    },
    scopes: [
      'app_mentions:read',
      'channels:history',
      'channels:read',
      'chat:write',
      'groups:history',
      'groups:read',
      'im:history',
      'mpim:history',
      'mpim:read',
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

        console.log(`Installed for workspace: ${teamName} (${teamId})`);

        const { WebClient } = require('@slack/web-api');
        const client = new WebClient(installation.bot.token);

        // Sync all workspace users in background
        const { syncUsersBackground } = require('./handlers');
        syncUsersBackground(client, teamId, supabase);

        // Send welcome DM
        try {
          await client.chat.postMessage({
            channel: installation.user.id,
            text: `*Welcome to Ping!*\n\nPing helps you track tasks and monitor your team — right inside Slack.\n\n*Get started:*\n• Open the <slack://app?team=${teamId}&id=${installation.bot.id}&tab=home|Ping Home tab> to manage tasks\n• Use *My Tasks* to see your work\n• Use *People* to assign tasks to teammates\n• Use *Pinned* to track key people\n\nYou're all set!`
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
        await supabase.from('workspaces').update({ slack_team_id: null }).eq('slack_team_id', teamId);
        console.log(`Slack disconnected for team ${teamId} — workspace unlinked`);
      }
    }
  });

  const app = new App({ receiver });

  // Express routes
  receiver.router.get('/health', (_req, res) => res.status(200).send('OK'));

  // Helper to check admin secret from Authorization header
  const checkAdminSecret = (req) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    return token === process.env.SYNC_SECRET;
  };

  receiver.router.get('/sync-users', async (req, res) => {
    if (!checkAdminSecret(req)) {
      return res.status(401).send('Unauthorized');
    }

    const { data: installations, error } = await supabase.from('installations').select('team_id, bot_token, team_name');
    if (error) return res.status(500).send('Internal server error');

    res.json({ message: `Syncing ${installations.length} workspace(s) in background...`, workspaces: installations.map(i => i.team_name) });

    const { WebClient } = require('@slack/web-api');
    const { syncUsersBackground } = require('./handlers');
    for (const install of installations) {
      const client = new WebClient(install.bot_token);
      syncUsersBackground(client, install.team_id, supabase);
    }
  });

  receiver.router.get('/test-standup', async (req, res) => {
    if (!checkAdminSecret(req)) {
      return res.status(401).send('Unauthorized');
    }
    const { user, team } = req.query;
    if (!user || !team) {
      return res.status(400).send('Missing user or team query params');
    }

    try {
      const { data: install } = await supabase
        .from('installations')
        .select('bot_token')
        .eq('team_id', team)
        .single();

      if (!install) return res.status(404).send('Not found');

      const { WebClient } = require('@slack/web-api');
      const client = new WebClient(install.bot_token);

      await triggerStandupForUser(client, user, team, supabase);
      res.send('Standup nudge sent');
    } catch (err) {
      console.error('[test-standup] Error:', err.message);
      res.status(500).send('Internal server error');
    }
  });

  // Register all Slack event/action handlers
  registerHandlers(app, supabase, { pendingBulkCreations, dmContext });

  // Start standup scheduler
  startStandupScheduler(app, supabase);

  return { app, receiver };
}

module.exports = { initBot };
