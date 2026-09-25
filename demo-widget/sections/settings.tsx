import SettingsPage from '@/app/(app)/settings/page'
import SupportPage from '@/app/(app)/support/page'
import type { RouteRender } from '../route-helpers'

export const renders: Record<string, RouteRender> = {
  '/settings': () => <SettingsPage />,
  '/support': () => <SupportPage />,
}
