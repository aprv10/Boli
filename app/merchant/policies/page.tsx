import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadActiveMerchantPolicy } from '@/src/application/policy-gate';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { RuleEditor } from './rule-editor';
export default async function PoliciesPage() {
  await ensureDatabase(env.DB);
  const policy = await loadActiveMerchantPolicy(env.DB, DEMO_MERCHANT.id);
  const history = await env.DB.prepare("SELECT version, minimum_margin_bps AS margin, maximum_automatic_concession_bps AS concession, created_at AS date FROM merchant_policy_versions WHERE merchant_id = ? ORDER BY version DESC LIMIT 10").bind(DEMO_MERCHANT.id).all<{version:number;margin:number;concession:number;date:string}>();
  return <main className="new-shell merchant-workspace"><header className="merchant-heading"><div><p className="eyebrow">The Good Batch</p><h1>Rules</h1><p>Set the limits Boli must respect when building and negotiating offers.</p></div></header><section className="merchant-content">
    <RuleEditor version={policy.version} margin={policy.minimumMarginBps} concession={policy.maximumAutomaticConcessionBps} />
    <details className="merchant-history"><summary>Rule change history</summary>{history.results.map(item => <p key={item.version}>{item.date.slice(0,10)} · Margin floor {item.margin / 100}% · Automatic reduction limit {item.concession / 100}% <small>Revision {item.version}</small></p>)}</details>
    <p className="workspace-note">Local demo workspace. Rule edits are recorded and applied by the backend.</p>
  </section></main>;
}
