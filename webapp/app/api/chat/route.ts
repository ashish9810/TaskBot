import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

const groqApiKey = process.env.GROQ_API_KEY
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Inbox',
  active: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
}

interface Task {
  id: string
  title: string
  status: string
  priority?: string
  due_date?: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, conversationContext } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 })

  if (!groq) {
    return NextResponse.json({
      intent: 'unknown',
      reply: '⚠️ AI assistant is not configured. GROQ_API_KEY is missing from environment variables.',
      needsConfirmation: false,
      executed: false,
    })
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get workspace
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

  // Fetch user's tasks
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

  // Build context for AI
  const contextSummary = `User's tasks:
- Inbox (${taskContext.backlog.length}): ${taskContext.backlog.slice(0, 15).map((t, i) => `${i + 1}. "${t.title}" [id:${t.id}]`).join(', ') || 'none'}
- To Do (${taskContext.active.length}): ${taskContext.active.slice(0, 15).map((t, i) => `${i + 1}. "${t.title}" [id:${t.id}]`).join(', ') || 'none'}
- In Progress (${taskContext.in_progress.length}): ${taskContext.in_progress.slice(0, 15).map((t, i) => `${i + 1}. "${t.title}" [id:${t.id}]`).join(', ') || 'none'}
- Done (${taskContext.completed.length}): ${taskContext.completed.slice(0, 15).map((t, i) => `${i + 1}. "${t.title}" [id:${t.id}]`).join(', ') || 'none'}`

  const recentListContext = conversationContext?.recentList
    ? `\nRecently shown numbered list:\n${conversationContext.recentList.map((t: { index: number; title: string; status: string; id: string }) => `${t.index}. "${t.title}" (status: ${t.status}) [id:${t.id}]`).join('\n')}`
    : ''

  const prompt = `You are Ping, a friendly task management AI assistant. Understand what the user wants and return a structured JSON response.

${contextSummary}
${recentListContext}

User message: "${message}"

Return ONLY valid JSON:
{
  "intent": "create" | "move" | "delete" | "view" | "summary" | "unknown",
  "reply": "friendly human-readable response to show the user",
  "sourceStatus": "backlog" | "active" | "in_progress" | "completed" | null,
  "targetStatus": "backlog" | "active" | "in_progress" | "completed" | null,
  "taskIds": ["uuid1", "uuid2"] | null,
  "scope": "all" | "specific" | null,
  "createTasks": [{ "title": "task title" }] | null,
  "needsList": true | false,
  "needsConfirmation": true | false
}

Rules:
- "reply": ALWAYS include a friendly message. Use markdown for formatting. Keep it concise.
- "intent": create, move, delete, view, summary, or unknown
- Status mapping: inbox/backlog→"backlog", todo/to-do→"active", in progress→"in_progress", done/complete→"completed"
- "taskIds": include actual task UUIDs from the context when user references specific tasks by number. Match numbers to the appropriate status list.
- "needsList": true when we need to show the user a list before they can pick tasks
- "needsConfirmation": true for destructive actions (delete, move) when we know which tasks
- "createTasks": for "create" intent, extract clean task titles. Remove filler words. Only include REAL described tasks.
- For "view" intent: set reply to include the numbered task list formatted nicely
- For "summary": set reply to include a clean summary with counts and status emojis
- For "unknown": set reply to a helpful message with example commands
- When user references numbers like "1, 3, 4" — match them to the recently shown list or the appropriate status list`

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 1024,
    })

    const text = chatCompletion.choices[0]?.message?.content || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    // Sanitize JSON: remove control characters inside string values that break JSON.parse
    const sanitized = jsonMatch[0]
      .replace(/[\x00-\x1F\x7F]/g, (ch) => {
        if (ch === '\n' || ch === '\r' || ch === '\t') return ' '
        return ''
      })

    const intent = JSON.parse(sanitized)

    // Build the list if needed
    let recentList = conversationContext?.recentList || null
    if (intent.needsList && intent.sourceStatus) {
      const statusTasks = taskContext[intent.sourceStatus as keyof typeof taskContext] || []
      recentList = statusTasks.map((t: Task, i: number) => ({
        index: i + 1,
        id: t.id,
        title: t.title,
        status: t.status,
      }))
    }

    // Execute actions that don't need confirmation
    let executed = false

    // Auto-execute: create tasks
    if (intent.intent === 'create' && intent.createTasks && intent.createTasks.length > 0 && !intent.needsConfirmation) {
      const created = []
      for (const task of intent.createTasks) {
        const insert: Record<string, unknown> = {
          title: task.title.trim(),
          user_id: taskUserId,
          workspace_id: ws.id,
          status: 'active',
        }
        if (taskTeamId) insert.team_id = taskTeamId

        const { data, error } = await admin.from('tasks').insert(insert).select().single()
        if (!error && data) created.push(data)
      }
      executed = true
      intent.reply = `✅ Created ${created.length} task(s) in your To Do:\n${created.map((t: Record<string, unknown>) => `• ${t.title}`).join('\n')}`
    }

    // Execute confirmed actions (move/delete) when taskIds are provided
    // Only operate on tasks the user owns (taskIds come from AI context which is already filtered to user's tasks)
    const userTaskIds = new Set(tasks.map(t => t.id))

    if (intent.intent === 'move' && intent.taskIds && intent.taskIds.length > 0 && !intent.needsConfirmation) {
      let moved = 0
      for (const taskId of intent.taskIds) {
        if (!userTaskIds.has(taskId)) continue // skip tasks not owned by user
        const updates: Record<string, unknown> = { status: intent.targetStatus }
        if (intent.targetStatus === 'completed') updates.completed_at = new Date().toISOString()
        else updates.completed_at = null

        const { error } = await admin.from('tasks').update(updates).eq('id', taskId)
        if (!error) moved++
      }
      executed = true
    }

    if (intent.intent === 'delete' && intent.taskIds && intent.taskIds.length > 0 && !intent.needsConfirmation) {
      let deleted = 0
      for (const taskId of intent.taskIds) {
        if (!userTaskIds.has(taskId)) continue // skip tasks not owned by user
        await admin.from('updates').delete().eq('task_id', taskId)
        const { error } = await admin.from('tasks').delete().eq('id', taskId)
        if (!error) deleted++
      }
      executed = true
    }

    return NextResponse.json({
      intent: intent.intent,
      reply: intent.reply,
      needsConfirmation: intent.needsConfirmation || false,
      needsList: intent.needsList || false,
      taskIds: intent.taskIds,
      targetStatus: intent.targetStatus,
      sourceStatus: intent.sourceStatus,
      recentList,
      executed,
      createTasks: intent.createTasks,
    })

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('Chat API error:', errorMsg)
    return NextResponse.json({
      intent: 'unknown',
      reply: 'Sorry, something went wrong. Please try again.',
      needsConfirmation: false,
      executed: false,
    })
  }
}

// Execute confirmed actions
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, taskIds, targetStatus } = await request.json()

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify ownership of all referenced tasks
  if (taskIds && Array.isArray(taskIds) && taskIds.length > 0) {
    const { data: slackLinks } = await admin.from('profile_slack_links').select('slack_user_id').eq('profile_id', user.id)
    const allowedUserIds = [user.id, ...(slackLinks?.map(l => l.slack_user_id) || [])]

    const { data: ownedTasks } = await admin
      .from('tasks')
      .select('id, user_id')
      .in('id', taskIds)

    const unauthorizedIds = (ownedTasks || []).filter(t => !allowedUserIds.includes(t.user_id)).map(t => t.id)
    if (unauthorizedIds.length > 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (action === 'move' && taskIds && targetStatus) {
    const allowed = ['backlog', 'active', 'in_progress', 'completed']
    if (!allowed.includes(targetStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    let moved = 0
    for (const taskId of taskIds) {
      const updates: Record<string, unknown> = { status: targetStatus }
      if (targetStatus === 'completed') updates.completed_at = new Date().toISOString()
      else updates.completed_at = null

      const { error } = await admin.from('tasks').update(updates).eq('id', taskId)
      if (!error) moved++
    }
    return NextResponse.json({ success: true, moved })
  }

  if (action === 'delete' && taskIds) {
    let deleted = 0
    for (const taskId of taskIds) {
      await admin.from('updates').delete().eq('task_id', taskId)
      const { error } = await admin.from('tasks').delete().eq('id', taskId)
      if (!error) deleted++
    }
    return NextResponse.json({ success: true, deleted })
  }

  if (action === 'create' && targetStatus) {
    // This is handled in POST, but keeping for completeness
    return NextResponse.json({ error: 'Use POST to create tasks' }, { status: 400 })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
