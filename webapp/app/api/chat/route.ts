import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runConversation } = require('@/lib/bot/tools')

interface Task {
  id: string
  title: string
  status: string
  priority?: string
  due_date?: string
}

interface HistoryMsg {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_call_id?: string
  tool_calls?: unknown
}

// Cap history we pass to the LLM (last N turns, excluding system).
// Each "turn" is a user message + assistant reply (+ optional tool messages).
const MAX_HISTORY_MESSAGES = 20

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, history } = (await request.json()) as {
    message?: string
    history?: HistoryMsg[]
  }
  if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces(id, slack_team_id)')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace' }, { status: 400 })
  const ws = membership.workspaces as unknown as { id: string; slack_team_id: string | null }

  // Resolve user identity (slack or web)
  let taskUserId = user.id
  let taskTeamId: string | null = null

  const { data: slackLink } = await admin
    .from('profile_slack_links')
    .select('slack_user_id, team_id')
    .eq('profile_id', user.id)
    .limit(1)
    .single()

  if (slackLink) {
    taskUserId = slackLink.slack_user_id
    taskTeamId = slackLink.team_id
  }

  // Fetch user's tasks (across both Slack and web identities)
  const { data: allTasks } = await admin
    .from('tasks')
    .select('id, title, status, priority, due_date, created_at')
    .or(`user_id.eq.${taskUserId},user_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  const tasks = (allTasks || []) as Task[]
  const taskContext = {
    backlog: tasks.filter(t => t.status === 'backlog'),
    active: tasks.filter(t => t.status === 'active'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    completed: tasks.filter(t => t.status === 'completed'),
  }

  // Trim incoming history to the last N messages for sanity
  const trimmedHistory = Array.isArray(history)
    ? history.filter(m => m && m.role !== 'system').slice(-MAX_HISTORY_MESSAGES)
    : []

  try {
    const result = await runConversation({
      userMessage: message,
      history: trimmedHistory,
      taskContext,
      ctx: {
        supabase: admin,
        userId: taskUserId,
        teamId: taskTeamId,
        workspaceId: ws.id,
      },
    })

    return NextResponse.json({
      reply: result.reply || "",
      executed: result.executed,
      toolCalls: result.toolCalls,
      history: result.updatedHistory.slice(-MAX_HISTORY_MESSAGES),
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('Chat API error:', errorMsg)
    return NextResponse.json({
      reply: 'Sorry, something went wrong. Please try again.',
      executed: false,
      toolCalls: [],
      history: trimmedHistory,
    })
  }
}
