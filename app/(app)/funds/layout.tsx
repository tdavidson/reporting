import { AnalystVehicleSync } from '@/components/analyst-scope'

// Every Funds page now renders its OWN header (the fund switcher + Analyst toggle, in a
// lowered group) and wraps its body in <AccountingBody>. There is no shared top utility
// bar anymore, so this layout just provides the section padding and keeps the app's ONE
// shared Analyst scoped to the selected vehicle. The vehicle CONTEXT lives higher up, in
// AppShell, so the sidebar can read it too.
//
// The horizontal padding wraps each page's header and body together, because the Analyst
// panel is in the body: with the padding on each page instead, the panel had nothing
// between it and the viewport and sat flush against the right edge.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalystVehicleSync />
      <div className="w-full px-4 md:pl-8 md:pr-4">{children}</div>
    </>
  )
}
