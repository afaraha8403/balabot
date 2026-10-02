import {type ComponentType, useEffect, useRef, useState} from 'react';
import {Brain, CloudDownload, Cpu, Gauge, Monitor, Settings, Volume2, MessageSquare, ShieldCheck, X} from 'lucide-react';
import {ModelSettingsOverlay} from './ModelSettingsOverlay';
import {MemorySettingsOverlay} from './MemorySettingsOverlay';
import {VoiceSettingsOverlay} from './VoiceSettingsOverlay';
import {MessagingSettingsOverlay} from './MessagingSettingsOverlay';
import {ApprovalRulesSettings} from './ApprovalRulesSettings';
import {
  GeneralSettingsPanel,
  UsageSettingsPanel,
  ComputerSettingsPanel,
  UpdatesSettingsPanel,
} from './AccountSettingsPanels';

export type SettingsSection =
  | 'general'
  | 'models'
  | 'memory'
  | 'voice'
  | 'usage'
  | 'computer'
  | 'updates'
  | 'messaging'
  | 'approvals';

type NavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{size?: number; className?: string; strokeWidth?: number; style?: React.CSSProperties}>;
};

export type SettingsOverlayProps = {
  initialSection?: SettingsSection;
  onClose: () => void;
  // Account & General
  userName?: string;
  email?: string | null;
  avatarStyle?: 'robot' | 'organic';
  onAvatarStyleChange?: (style: 'robot' | 'organic') => Promise<void>;
  // Fleet update callback
  onFleetChanged?: () => void;
  // Slots for tab bodies
  renderGeneral?: () => React.ReactNode;
  renderModels?: () => React.ReactNode;
  renderMemory?: () => React.ReactNode;
  renderVoice?: () => React.ReactNode;
  renderUsage?: () => React.ReactNode;
  renderComputer?: () => React.ReactNode;
  renderUpdates?: () => React.ReactNode;
  renderMessaging?: () => React.ReactNode;
  renderApprovals?: () => React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {id: 'general', label: 'General', icon: Settings},
  {id: 'models', label: 'Models', icon: Cpu},
  {id: 'memory', label: 'Memory', icon: Brain},
  {id: 'voice', label: 'Voice', icon: Volume2},
  {id: 'usage', label: 'Usage', icon: Gauge},
  {id: 'computer', label: 'Computer', icon: Monitor},
  {id: 'updates', label: 'Updates', icon: CloudDownload},
  {id: 'messaging', label: 'Messaging', icon: MessageSquare},
  {id: 'approvals', label: 'Approvals', icon: ShieldCheck},
];

/**
 * Polaris SettingsOverlay:
 * Unified modal dialog with 9 tabs (General, Models, Memory, Voice, Usage, Computer, Updates, Messaging, Approvals).
 */
export function SettingsOverlay({
  initialSection = 'general',
  onClose,
  userName = 'Ali',
  email = 'ali@balacode.xyz',
  avatarStyle = 'robot',
  onAvatarStyleChange,
  onFleetChanged,
  renderGeneral,
  renderModels,
  renderMemory,
  renderVoice,
  renderUsage,
  renderComputer,
  renderUpdates,
  renderMessaging,
  renderApprovals,
}: SettingsOverlayProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeItem = NAV_ITEMS.find(item => item.id === section);
  const sectionTitle = activeItem ? activeItem.label : 'Settings';
  const isWide = section === 'models' || section === 'voice';

  return (
    <div
      className="polaris-dialog-backdrop"
      style={{zIndex: 1000}}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        role="dialog"
        aria-modal="true"
        aria-label={`${sectionTitle} settings`}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: isWide ? 'min(1080px, calc(100% - 2rem))' : 'min(920px, calc(100% - 2rem))',
          height: isWide ? 'min(760px, calc(100% - 2rem))' : 'min(720px, calc(100% - 2rem))',
          maxHeight: 'calc(100% - 2rem)',
          backgroundColor: 'var(--popover)',
          color: 'var(--popover-foreground)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl, 16px)',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          boxSizing: 'border-box',
          transition: 'width 150ms ease, height 150ms ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            flexDirection: 'row',
            overflow: 'hidden',
          }}
        >
          {/* Settings Left Navigation Sidebar */}
          <nav
            data-testid="settings-nav"
            aria-label="Settings"
            style={{
              width: '200px',
              minWidth: '200px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              borderRight: '1px solid var(--border)',
              padding: '16px 12px',
              backgroundColor: 'var(--sidebar, var(--popover))',
              overflowY: 'auto',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`settings-nav-${item.id}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md, 8px)',
                    border: 'none',
                    backgroundColor: active ? 'var(--muted)' : 'transparent',
                    color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
                    cursor: 'pointer',
                    fontSize: '13.5px',
                    fontWeight: active ? 500 : 400,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'all 120ms ease',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'var(--accent)';
                      e.currentTarget.style.color = 'var(--foreground)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--muted-foreground)';
                    }
                  }}
                >
                  <Icon size={16} strokeWidth={1.75} style={{flexShrink: 0}} />
                  <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Settings Right Content Area */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              backgroundColor: 'var(--background)',
            }}
          >
            {/* Header bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '24px 28px 16px 28px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '22px',
                  fontWeight: 500,
                  color: 'var(--foreground)',
                  letterSpacing: '-0.01em',
                }}
              >
                {sectionTitle}
              </h2>
              <button
                type="button"
                aria-label={`Close ${sectionTitle} settings`}
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

            {/* Scrollable Tab Content Container */}
            <div
              className="rk-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '24px 28px',
                boxSizing: 'border-box',
              }}
            >
              {section === 'general' && (renderGeneral ? renderGeneral() : (
                <GeneralSettingsPanel userName={userName} email={email} />
              ))}

              {section === 'models' && (renderModels ? renderModels() : (
                <ModelSettingsOverlay embedded onClose={onClose} />
              ))}

              {section === 'memory' && (renderMemory ? renderMemory() : (
                <MemorySettingsOverlay embedded onClose={onClose} />
              ))}

              {section === 'voice' && (renderVoice ? renderVoice() : (
                <VoiceSettingsOverlay embedded onClose={onClose} />
              ))}

              {section === 'usage' && (renderUsage ? renderUsage() : (
                <UsageSettingsPanel />
              ))}

              {section === 'computer' && (renderComputer ? renderComputer() : (
                <ComputerSettingsPanel onFleetChanged={onFleetChanged} />
              ))}

              {section === 'updates' && (renderUpdates ? renderUpdates() : (
                <UpdatesSettingsPanel />
              ))}

              {section === 'messaging' && (renderMessaging ? renderMessaging() : (
                <MessagingSettingsOverlay embedded onClose={onClose} />
              ))}

              {section === 'approvals' && (renderApprovals ? renderApprovals() : (
                <ApprovalRulesSettings embedded onClose={onClose} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
