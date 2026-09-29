import {useCallback, useEffect, useState} from 'react';
import {
  Boxes,
  Check,
  ChevronRight,
  ExternalLink,
  Layers,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
  X,
  Pin,
  Info,
  ShieldAlert,
} from 'lucide-react';
import {
  getSkillLibrary,
  postSkillPin,
  postSkillPromote,
  type Bot,
  type SkillEntry,
  type SkillLibraryResponse,
} from './api';

export type ConnectorTile = {
  id: string;
  name: string;
  category: string;
  description: string;
  connected?: boolean;
};

export const FEATURED_CONNECTORS: ConnectorTile[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'Developer Tools',
    description: 'Repository access, pull request reviews, commit workflows, and issue tracking.',
    connected: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Post updates, listen to channel mentions, and coordinate team notifications.',
    connected: true,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Database',
    category: 'Data & Storage',
    description: 'Direct query execution, schema inspection, and analytics reporting.',
    connected: false,
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Productivity',
    description: 'Sprint planning, ticket creation, triage sync, and issue decomposition.',
    connected: false,
  },
  {
    id: 'notion',
    name: 'Notion Workspace',
    category: 'Knowledge Base',
    description: 'Read and write company wikis, meeting docs, and knowledge bases.',
    connected: false,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'Storage',
    description: 'Document extraction, spreadsheet calculation, and PDF parsing.',
    connected: false,
  },
];

type Props = {
  onClose: () => void;
  onOpenMcp?: () => void;
  bots?: Bot[];
  activeBotId?: string | null;
  initialTab?: 'connectors' | 'skills';
};

/**
 * Polaris PluginsOverlay:
 * Integrations catalog and connector marketplace with remounted Installed Skills tab.
 */
export function PluginsOverlay({
  onClose,
  onOpenMcp,
  bots = [],
  activeBotId = null,
  initialTab = 'connectors',
}: Props) {
  const [activeTab, setActiveTab] = useState<'connectors' | 'skills'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectors, setConnectors] = useState<ConnectorTile[]>(FEATURED_CONNECTORS);

  // Skill Library state (remounted from SkillLibraryDialog)
  const [skillGroup, setSkillGroup] = useState<'learned' | 'brought'>('brought');
  const [library, setLibrary] = useState<SkillLibraryResponse | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
  const [promoteNotice, setPromoteNotice] = useState('');

  const reloadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillError('');
    try {
      const lib = await getSkillLibrary(activeBotId ?? undefined);
      setLibrary(lib);
    } catch (e) {
      setSkillError((e as Error).message);
      setLibrary(null);
    } finally {
      setSkillsLoading(false);
    }
  }, [activeBotId]);

  useEffect(() => {
    if (activeTab === 'skills') {
      void reloadSkills();
    }
  }, [activeTab, reloadSkills]);

  const toggleConnector = (id: string) => {
    setConnectors(prev =>
      prev.map(c => (c.id === id ? {...c, connected: !c.connected} : c))
    );
  };

  const handlePin = async (entry: SkillEntry) => {
    try {
      const res = (await postSkillPin({name: entry.name, pinned: entry.state !== 'pinned'})) as any;
      if (res && res.available === false) {
        setSkillError(`Pin is not available: ${res.reason ?? 'backend unavailable'}`);
        return;
      }
      await reloadSkills();
    } catch (err) {
      setSkillError((err as Error).message);
    }
  };

  const handlePromote = async (name: string) => {
    try {
      const res = (await postSkillPromote({name, share: 'all'})) as any;
      if (res && res.available === false) {
        setSkillError(`Promote is not available: ${res.reason ?? 'backend unavailable'}`);
        return;
      }
      setPromoteNotice(`Skill ${name} promoted to all fleet bots.`);
      setTimeout(() => setPromoteNotice(''), 3000);
      await reloadSkills();
    } catch (err) {
      setSkillError((err as Error).message);
    }
  };

  const filteredConnectors = connectors.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const skillEntries: SkillEntry[] = library?.[skillGroup] ?? [];

  return (
    <div
      className="polaris-dialog-backdrop"
      style={{zIndex: 1000}}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="plugins-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Plugins and Integrations"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: 'min(960px, calc(100% - 2rem))',
          height: 'min(720px, calc(100% - 2rem))',
          maxHeight: 'calc(100% - 2rem)',
          backgroundColor: 'var(--popover)',
          color: 'var(--popover-foreground)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl, 16px)',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <LayoutGrid size={22} style={{color: 'var(--foreground)'}} />
              <h2 style={{margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--foreground)'}}>
                Integrations & Skills
              </h2>
            </div>

            {/* Top Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: 'var(--muted)',
                borderRadius: 'var(--radius-md, 8px)',
                padding: '3px',
                gap: '2px',
              }}
            >
              <button
                type="button"
                data-testid="tab-connectors"
                aria-pressed={activeTab === 'connectors'}
                onClick={() => setActiveTab('connectors')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: activeTab === 'connectors' ? 'var(--card)' : 'transparent',
                  color: activeTab === 'connectors' ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontSize: '13px',
                  fontWeight: activeTab === 'connectors' ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                Connectors
              </button>
              <button
                type="button"
                data-testid="tab-installed-skills"
                aria-pressed={activeTab === 'skills'}
                onClick={() => setActiveTab('skills')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: activeTab === 'skills' ? 'var(--card)' : 'transparent',
                  color: activeTab === 'skills' ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontSize: '13px',
                  fontWeight: activeTab === 'skills' ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                Installed Skills
              </button>
            </div>
          </div>

          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {onOpenMcp ? (
              <button
                type="button"
                data-testid="open-mcp-btn"
                onClick={() => {
                  onClose();
                  onOpenMcp();
                }}
                className="polaris-btn polaris-btn-outline"
                style={{height: '32px', fontSize: '12.5px', gap: '6px'}}
              >
                <Boxes size={14} />
                MCP Servers
              </button>
            ) : null}

            <button
              type="button"
              aria-label="Close integrations"
              onClick={onClose}
              className="polaris-btn polaris-btn-outline"
              style={{
                width: '32px',
                height: '32px',
                padding: 0,
                borderRadius: '9999px',
              }}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Tab 1: Connectors Marketplace */}
        {activeTab === 'connectors' && (
          <div
            className="rk-scroll"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxSizing: 'border-box',
            }}
          >
            {/* Search Box */}
            <div style={{position: 'relative'}}>
              <input
                type="text"
                data-testid="connector-search-input"
                placeholder="Search integrations, tools, and services…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="polaris-input"
                style={{paddingLeft: '34px'}}
              />
              <Search size={15} style={{position: 'absolute', left: '12px', top: '12px', color: 'var(--muted-foreground)'}} />
            </div>

            {/* Connectors Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '14px',
              }}
            >
              {filteredConnectors.map(c => (
                <div
                  key={c.id}
                  data-testid={`connector-tile-${c.id}`}
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--card)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                      <h4 style={{margin: '0', fontSize: '14.5px', fontWeight: 600, color: 'var(--foreground)'}}>
                        {c.name}
                      </h4>
                      <span style={{fontSize: '11px', color: 'var(--muted-foreground)', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)'}}>
                        {c.category}
                      </span>
                    </div>
                    <p style={{margin: '8px 0 0 0', fontSize: '12.5px', color: 'var(--muted-foreground)', lineHeight: 1.4}}>
                      {c.description}
                    </p>
                  </div>

                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border)'}}>
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: c.connected ? 'var(--success, #22c55e)' : 'var(--muted-foreground)'}}>
                      {c.connected ? <Check size={13} strokeWidth={2.5} /> : null}
                      {c.connected ? 'Connected' : 'Available'}
                    </span>
                    <button
                      type="button"
                      data-testid={`connector-toggle-${c.id}`}
                      onClick={() => toggleConnector(c.id)}
                      className={`polaris-btn ${c.connected ? 'polaris-btn-outline' : 'polaris-btn-primary'}`}
                      style={{height: '28px', fontSize: '12px', padding: '0 12px'}}
                    >
                      {c.connected ? 'Disconnect' : 'Connect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Remounted SkillLibraryDialog ("Installed Skills") */}
        {activeTab === 'skills' && (
          <div
            className="rk-scroll"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              boxSizing: 'border-box',
            }}
          >
            {/* Skill Group Switcher: Learned vs Brought */}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <div style={{display: 'flex', gap: '6px'}}>
                <button
                  type="button"
                  data-testid="skill-group-brought"
                  aria-pressed={skillGroup === 'brought'}
                  onClick={() => setSkillGroup('brought')}
                  className={`polaris-btn ${skillGroup === 'brought' ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                  style={{height: '32px', fontSize: '13px'}}
                >
                  Brought Skills
                </button>
                <button
                  type="button"
                  data-testid="skill-group-learned"
                  aria-pressed={skillGroup === 'learned'}
                  onClick={() => setSkillGroup('learned')}
                  className={`polaris-btn ${skillGroup === 'learned' ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                  style={{height: '32px', fontSize: '13px'}}
                >
                  Learned Skills
                </button>
              </div>

              <button
                type="button"
                data-testid="reload-skills-btn"
                disabled={skillsLoading}
                onClick={() => void reloadSkills()}
                className="polaris-btn polaris-btn-outline"
                style={{height: '32px', fontSize: '12px', gap: '6px'}}
              >
                <RefreshCw size={13} className={skillsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {promoteNotice ? (
              <div role="status" style={{padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--accent)', color: 'var(--foreground)', fontSize: '13px'}}>
                {promoteNotice}
              </div>
            ) : null}

            {skillError ? (
              <div role="alert" style={{padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--destructive)', fontSize: '13px'}}>
                {skillError}
              </div>
            ) : null}

            {/* Skills List */}
            {skillsLoading && library === null ? (
              <div style={{textAlign: 'center', padding: '32px', color: 'var(--muted-foreground)', fontSize: '13.5px'}}>
                Loading skills from library…
              </div>
            ) : skillEntries.length === 0 ? (
              <div
                style={{
                  padding: '36px',
                  textAlign: 'center',
                  backgroundColor: 'var(--muted)',
                  borderRadius: 'var(--radius-lg, 12px)',
                  color: 'var(--muted-foreground)',
                  fontSize: '13.5px',
                }}
              >
                {skillGroup === 'learned'
                  ? 'No self-improved skills yet. Skills attributed to the autonomous improvement loop will appear here.'
                  : 'No brought skills installed in this profile.'}
              </div>
            ) : (
              <div data-testid="installed-skills-list" style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                {skillEntries.map(entry => (
                  <div
                    key={entry.name}
                    data-testid={`skill-row-${entry.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md, 10px)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--card)',
                    }}
                  >
                    <div>
                      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <span style={{fontWeight: 600, fontSize: '14px', color: 'var(--foreground)'}}>{entry.name}</span>
                        <span style={{fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)'}}>
                          {entry.source}
                        </span>
                        {entry.state === 'pinned' ? (
                          <span style={{fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--success, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: '3px'}}>
                            <Pin size={10} /> Pinned
                          </span>
                        ) : null}
                      </div>
                      <div style={{fontSize: '12.5px', color: 'var(--muted-foreground)', marginTop: '4px'}}>
                        {entry.description || 'No description provided.'}
                      </div>
                    </div>

                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <button
                        type="button"
                        data-testid={`pin-skill-${entry.name}`}
                        onClick={() => void handlePin(entry)}
                        className="polaris-btn polaris-btn-outline"
                        style={{height: '28px', fontSize: '12px', gap: '4px'}}
                      >
                        <Pin size={12} />
                        {entry.state === 'pinned' ? 'Unpin' : 'Pin'}
                      </button>

                      <button
                        type="button"
                        data-testid={`promote-skill-${entry.name}`}
                        onClick={() => void handlePromote(entry.name)}
                        className="polaris-btn polaris-btn-primary"
                        style={{height: '28px', fontSize: '12px', gap: '4px'}}
                      >
                        <Upload size={12} />
                        Promote
                      </button>

                      <button
                        type="button"
                        data-testid={`detail-skill-${entry.name}`}
                        onClick={() => setSelectedSkill(entry)}
                        className="polaris-btn polaris-btn-outline"
                        style={{width: '28px', height: '28px', padding: 0}}
                      >
                        <Info size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Selected Skill Details Modal */}
            {selectedSkill ? (
              <div
                style={{
                  padding: '16px',
                  borderRadius: 'var(--radius-lg, 12px)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--background)',
                  marginTop: '10px',
                }}
              >
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <h4 style={{margin: 0, fontSize: '14px', fontWeight: 600}}>{selectedSkill.name} Details</h4>
                  <button
                    type="button"
                    onClick={() => setSelectedSkill(null)}
                    className="polaris-btn polaris-btn-outline"
                    style={{width: '24px', height: '24px', padding: 0}}
                  >
                    <X size={12} />
                  </button>
                </div>
                <p style={{margin: '8px 0', fontSize: '13px', color: 'var(--muted-foreground)'}}>
                  {selectedSkill.description || 'No description.'}
                </p>
                <div style={{fontSize: '12px', color: 'var(--muted-foreground)'}}>
                  Grants: {Array.isArray(selectedSkill.grants) ? selectedSkill.grants.join(', ') : selectedSkill.grants || 'not shared'}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
