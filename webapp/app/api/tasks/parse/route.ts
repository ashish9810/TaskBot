import { createClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, members } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'No message provided' }, { status: 400 })

  const memberList = (members || [])
    .map((m: { name: string }) => m.name)
    .join(', ')

  const prompt = `You are a task parser. Extract one or more tasks from this natural language input.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{ "tasks": [{ "title": string, "assignee_hint": string | null }] }

Rules:
- title: concise task description, cleaned up
- assignee_hint: person name from the message, "me" if assigned to self, or null if unspecified
- Support bulk input (numbered lists) — return multiple task objects
- Available team members: ${memberList || 'none specified'}

Input: ${message}`

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) throw new Error('Invalid response shape')

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('Parse error:', err)
    return NextResponse.json({ error: 'Failed to parse tasks' }, { status: 500 })
  }
}
