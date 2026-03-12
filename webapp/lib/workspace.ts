import { SupabaseClient } from '@supabase/supabase-js'

export type Workspace = {
  id: string
  name: string
  created_by: string
  slack_team_id: string | null
  created_at: string
}

export type WorkspaceMember = {
  workspace_id: string
  profile_id: string
  role: 'owner' | 'member'
  joined_at: string
}

/**
 * Create a new workspace and add the user as owner.
 */
export async function createWorkspace(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<Workspace> {
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .insert({ name: name.trim(), created_by: userId })
    .select()
    .single()

  if (error || !workspace) throw new Error(error?.message || 'Failed to create workspace')

  const { error: memberError } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, profile_id: userId, role: 'owner' })

  if (memberError) throw new Error(memberError.message)

  return workspace
}

/**
 * Get the workspace the current user belongs to (one per user for MVP).
 */
export async function getUserWorkspace(
  supabase: SupabaseClient,
  userId: string
): Promise<(Workspace & { role: string }) | null> {
  const { data } = await supabase
    .from('workspace_members')
    .select('role, workspaces(*)')
    .eq('profile_id', userId)
    .single()

  if (!data) return null

  return {
    ...(data.workspaces as unknown as Workspace),
    role: data.role,
  }
}

/**
 * Join an existing workspace via invite token.
 * Returns error string if blocked, null on success.
 */
export async function joinWorkspaceByToken(
  supabase: SupabaseClient,
  userId: string,
  token: string
): Promise<{ error?: string; workspace?: Workspace }> {
  // Check if user already in a workspace
  const { data: existing } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', userId)
    .single()

  if (existing) {
    return { error: 'already_in_workspace' }
  }

  // Look up the invite token
  const { data: invite } = await supabase
    .from('workspace_invites')
    .select('workspace_id, workspaces(id, name, created_by, slack_team_id, created_at)')
    .eq('token', token)
    .single()

  if (!invite) {
    return { error: 'invalid_token' }
  }

  // Join the workspace
  const { error } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: invite.workspace_id, profile_id: userId, role: 'member' })

  if (error) return { error: error.message }

  return { workspace: invite.workspaces as unknown as Workspace }
}

/**
 * Get invite token for a workspace (create one if none exists).
 */
export async function getOrCreateInvite(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string
): Promise<string> {
  // Try existing invite
  const { data: existing } = await supabase
    .from('workspace_invites')
    .select('token')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) return existing.token

  // Create new invite
  const { data: newInvite, error } = await supabase
    .from('workspace_invites')
    .insert({ workspace_id: workspaceId, created_by: userId })
    .select('token')
    .single()

  if (error || !newInvite) throw new Error('Failed to create invite')
  return newInvite.token
}

/**
 * Regenerate invite token (delete old, insert new).
 */
export async function regenerateInvite(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string
): Promise<string> {
  await supabase
    .from('workspace_invites')
    .delete()
    .eq('workspace_id', workspaceId)

  const { data, error } = await supabase
    .from('workspace_invites')
    .insert({ workspace_id: workspaceId, created_by: userId })
    .select('token')
    .single()

  if (error || !data) throw new Error('Failed to regenerate invite')
  return data.token
}
