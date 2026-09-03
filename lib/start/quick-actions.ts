import type { Domain } from '@/lib/access/domains'
import type { AccessLevel } from '@/lib/access/effective'
import type { FeatureKey } from '@/lib/types/features'

/**
 * What /start offers before anything has been asked.
 *
 * Both lists are filtered through the SAME resolver the sidebar uses, so the landing page never
 * advertises a question the Analyst will refuse to answer or a form the API will 403. That is the
 * whole reason this is a pure function rather than JSX with `useCanRead` sprinkled through it:
 * the ordering and the filtering are the part worth pinning in a test.
 *
 * Affordances only — nothing here is a boundary. `/api/analyst` gates its own context by domain
 * and every create action posts to a gated route.
 */
export type Can = (domain: Domain, feature?: FeatureKey) => AccessLevel

interface Gated {
  domain: Domain
  /** Overrides the domain's primary switch, exactly as in the nav and the route registry. */
  feature?: FeatureKey
}

export interface SuggestedPrompt extends Gated {
  /** Stable key — tests pin these rather than the prose, which will be reworded. */
  id: string
  text: string
}

export interface CreateAction extends Gated {
  id: string
  /**
   * Used verbatim for `link` actions. For `modal` actions it is documentation: the page renders
   * that action's existing trigger component, which carries its own label so the wording stays the
   * same wherever the button appears.
   */
  label: string
  /**
   * `modal` actions are rendered by /start from an existing reusable button component; `link`
   * actions navigate to the page that owns the form. Deal and LP creation live inside their own
   * pages' dialogs with no reusable trigger, so they are links until one exists.
   */
  kind: 'modal' | 'link'
  href?: string
}

/**
 * Ordered widest-first: a fund running Portfolio Reporting alone should still see a full row, and
 * the accounting/LP questions only surface once those products are on.
 */
const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { id: 'portfolio-quarter', text: 'How is the portfolio doing this quarter?', domain: 'portfolio' },
  { id: 'portfolio-silent', text: 'Which companies have not reported recently?', domain: 'portfolio' },
  { id: 'lp-unfunded', text: 'Who has the largest unfunded commitment?', domain: 'lp_capital', feature: 'lp_tracking' },
  { id: 'dealflow-new', text: 'What came into the pipeline this month?', domain: 'dealflow', feature: 'deals' },
  { id: 'diligence-stalled', text: 'Which deals are in due diligence?', domain: 'diligence' },
]

const CREATE_ACTIONS: CreateAction[] = [
  { id: 'add-company', label: 'Add a company', kind: 'modal', domain: 'portfolio' },
  { id: 'import-documents', label: 'Import documents', kind: 'modal', domain: 'portfolio', feature: 'imports' },
  { id: 'add-deal', label: 'Add a deal', kind: 'link', href: '/deals', domain: 'dealflow', feature: 'deals' },
  { id: 'add-vehicle', label: 'Add a vehicle', kind: 'modal', domain: 'accounting' },
]

const canRead = (can: Can, g: Gated) => {
  const level = can(g.domain, g.feature)
  return level === 'read' || level === 'write'
}

/**
 * Questions to seed the composer with. Read is the right bar: a chip only promises the Analyst
 * will have the context to answer, not that the user may change anything.
 */
export function suggestedPrompts(can: Can, limit = 4): SuggestedPrompt[] {
  return SUGGESTED_PROMPTS.filter(p => canRead(can, p)).slice(0, limit)
}

/**
 * Create shortcuts. Write, not read — offering "Add a company" to a viewer produces a form whose
 * save button 403s, which is worse than not offering it.
 */
export function createActions(can: Can): CreateAction[] {
  return CREATE_ACTIONS.filter(a => can(a.domain, a.feature) === 'write')
}
