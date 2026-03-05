type SupabaseAdmin = { from: (table: string) => any }

export async function logActivity(
  admin: SupabaseAdmin,
  fundId: string,
  userId: string,
  action: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    // Check if user tracking is disabled for this fund
    const { data: settings } = await admin
      .from('fund_settings')
      .select('disable_user_tracking')
      .eq('fund_id', fundId)
      .maybeSingle()

    if (settings?.disable_user_tracking) return

    await admin.from('user_activity_logs').insert({
      fund_id: fundId,
      user_id: userId,
      action,
      metadata,
    })
  } catch (err) {
    console.error('[activity] Failed to log activity:', err)
  }
}
