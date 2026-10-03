import { useEffect, useState } from 'react';
import { useJSON } from './lib/data';
import { S, SourceTip } from './lib/src';
import Personas from './tabs/Personas';
import Builder from './tabs/Builder';
import Provenance from './tabs/Provenance';
import Retailer from './tabs/Retailer';
import Brand from './tabs/Brand';
import Shopper from './tabs/Shopper';
import AiVsHuman from './tabs/AiVsHuman';

const TABS = [
  { id: 'personas', label: 'personas', C: Personas },
  { id: 'build', label: 'build a persona', C: Builder },
  { id: 'provenance', label: 'where the data comes from', C: Provenance },
  { id: 'retailer', label: 'retailer', C: Retailer },
  { id: 'brand', label: 'brand', C: Brand },
  { id: 'shopper', label: 'shopper', C: Shopper },
  { id: 'ai', label: 'ai vs human', C: AiVsHuman },
] as const;
type TabId = (typeof TABS)[number]['id'];

const fromHash = (): TabId => {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return (TABS.find((t) => t.id === h)?.id || 'personas') as TabId;
};

export default function App() {
  const [tab, setTab] = useState<TabId>(fromHash());
  const man = useJSON<{ synced: string; files: Record<string, { src: string }> }>('manifest.json');
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = `${TABS.find((t) => t.id === tab)?.label} · simsbury`; }, [tab]);
  const Active = TABS.find((t) => t.id === tab)!.C;
  return (
    <div className="d-app">
      <header className="d-top">
        <div className="d-top-inner">
          <div className="d-brandmark">
            <h1 className="d-logo"><span>simsbury</span></h1>
            <p className="d-tagline">evidence dashboard · every number links to its source</p>
          </div>
          <div className="d-top-right">
            <span className="d-rule0"><b>rule zero</b> hover or tap any <span className="d-src-demo">dotted number</span> to see the file and field it came from</span>
            {man.data ? (
              <S src={{ file: 'web/public/data/dashboard/manifest.json', field: 'synced', note: `copied from data/ by web/scripts/sync-dashboard.mjs (${Object.keys(man.data.files).length} sources). re-run it after a new sim run.` }}>
                <small className="d-synced">data synced {new Date(man.data.synced).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</small>
              </S>
            ) : null}
            <a className="d-btn d-btn-white d-btn-sm" href="./">open the 3D store</a>
          </div>
        </div>
        <nav className="d-tabs" aria-label="dashboard sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={`d-tab ${t.id === tab ? 'is-on' : ''}`} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>
          ))}
        </nav>
      </header>
      <main className="d-main" key={tab}>
        <Active />
      </main>
      <SourceTip />
    </div>
  );
}
