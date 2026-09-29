import {useEffect, useState} from 'react';
import {
  Boxes,
  Check,
  Globe,
  Plus,
  Server,
  Terminal,
  Trash2,
  X,
  ShieldCheck,
  Bot as BotIcon,
} from 'lucide-react';
import type {Bot} from './api';

export type McpServerItem = {
  id: string;
  name: string;
  slug: string;
  transport: 'streamable_http' | 'stdio';
  endpoint?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  botIds: string[];
};

export const STORAGE_MCP_KEY = 'balabot:mcp-servers';

export const DEFAULT_MCP_SERVERS: McpServerItem[] = [
  {
    id: 'mcp-fs',
    name: 'Container Filesystem',
    slug: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    enabled: true,
    botIds: ['principal', 'governor'],
  },
  {
    id: 'mcp-brave',
    name: 'Brave Web Search',
    slug: 'brave-search',
    transport: 'streamable_http',
    endpoint: 'https://api.search.brave.com/res/v1/mcp',
    enabled: true,
    botIds: ['principal'],
  },
];

export function readMcpServers(): McpServerItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_MCP_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_MCP_SERVERS;
  } catch {
    return DEFAULT_MCP_SERVERS;
  }
}

export function writeMcpServers(servers: McpServerItem[]): void {
  try {
    localStorage.setItem(STORAGE_MCP_KEY, JSON.stringify(servers));
  } catch (err) {
    console.error('Failed to write MCP servers', err);
  }
}

type Props = {
  onClose: () => void;
  bots?: Bot[];
};

/**
 * Polaris McpServersOverlay:
 * Custom stdio and SSE MCP server registry with bot assignments.
 */
export function McpServersOverlay({onClose, bots = []}: Props) {
  const [servers, setServers] = useState<McpServerItem[]>(() => readMcpServers());
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'streamable_http' | 'stdio'>('streamable_http');
  const [endpoint, setEndpoint] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>(['principal']);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleToggleBot = (botId: string) => {
    setSelectedBotIds(prev =>
      prev.includes(botId) ? prev.filter(id => id !== botId) : [...prev, botId]
    );
  };

  const handleAddServer = () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please provide a server name.');
      return;
    }
    if (transport === 'streamable_http' && !endpoint.trim()) {
      setError('Please provide an HTTPS server endpoint URL.');
      return;
    }
    if (transport === 'stdio' && !command.trim()) {
      setError('Please provide a stdio command to execute.');
      return;
    }

    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newServer: McpServerItem = {
      id: `mcp_${Date.now()}`,
      name: trimmedName,
      slug,
      transport,
      endpoint: transport === 'streamable_http' ? endpoint.trim() : undefined,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.split(/\s+/).filter(Boolean) : undefined,
      enabled: true,
      botIds: selectedBotIds,
    };

    const next = [...servers, newServer];
    setServers(next);
    writeMcpServers(next);

    // Reset form
    setName('');
    setEndpoint('');
    setCommand('');
    setArgs('');
    setNotice(`MCP server "${trimmedName}" registered successfully.`);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleDelete = (id: string) => {
    const next = servers.filter(s => s.id !== id);
    setServers(next);
    writeMcpServers(next);
    setConfirmDeleteId(null);
  };

  const handleToggleEnable = (id: string) => {
    const next = servers.map(s => (s.id === id ? {...s, enabled: !s.enabled} : s));
    setServers(next);
    writeMcpServers(next);
  };

  return (
    <div
      className="polaris-dialog-backdrop"
      style={{zIndex: 1000}}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="mcp-servers-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="MCP Server Registry"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: 'min(920px, calc(100% - 2rem))',
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
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <Boxes size={22} style={{color: 'var(--foreground)'}} />
            <h2 style={{margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--foreground)'}}>
              Model Context Protocol (MCP) Servers
            </h2>
          </div>

          <button
            type="button"
            aria-label="Close MCP settings"
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

        {/* Content Body */}
        <div
          className="rk-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxSizing: 'border-box',
          }}
        >
          {notice ? (
            <div role="status" style={{padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--accent)', color: 'var(--foreground)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <ShieldCheck size={16} style={{color: 'var(--success, #22c55e)'}} />
              <span>{notice}</span>
            </div>
          ) : null}

          {error ? (
            <div role="alert" style={{padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--destructive)', fontSize: '13px'}}>
              {error}
            </div>
          ) : null}

          {/* Registered Servers List */}
          <div>
            <div style={{fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '10px'}}>
              Active MCP Tool Registrations
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              {servers.map(server => {
                const isConfirming = confirmDeleteId === server.id;
                return (
                  <div
                    key={server.id}
                    data-testid={`mcp-server-row-${server.slug}`}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-lg, 12px)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--card)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                      {server.transport === 'stdio' ? (
                        <Terminal size={18} style={{color: 'var(--primary)'}} />
                      ) : (
                        <Globe size={18} style={{color: 'var(--primary)'}} />
                      )}
                      <div>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                          <span style={{fontWeight: 600, fontSize: '14px', color: 'var(--foreground)'}}>{server.name}</span>
                          <span style={{fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)'}}>
                            {server.transport === 'stdio' ? 'stdio execution' : 'SSE HTTP'}
                          </span>
                          {server.enabled ? (
                            <span style={{fontSize: '11px', color: 'var(--success, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: '3px'}}>
                              <Check size={12} strokeWidth={2.5} /> Active
                            </span>
                          ) : (
                            <span style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>Disabled</span>
                          )}
                        </div>
                        <div style={{fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '3px'}}>
                          {server.transport === 'stdio' ? `${server.command} ${(server.args || []).join(' ')}` : server.endpoint}
                        </div>
                        <div style={{fontSize: '11.5px', color: 'var(--muted-foreground)', marginTop: '2px'}}>
                          Assigned to: {server.botIds.length ? server.botIds.join(', ') : 'no bots'}
                        </div>
                      </div>
                    </div>

                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <button
                        type="button"
                        onClick={() => handleToggleEnable(server.id)}
                        className={`polaris-btn ${server.enabled ? 'polaris-btn-outline' : 'polaris-btn-primary'}`}
                        style={{height: '28px', fontSize: '12px'}}
                      >
                        {server.enabled ? 'Disable' : 'Enable'}
                      </button>

                      {isConfirming ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(server.id)}
                          className="polaris-btn polaris-btn-destructive"
                          style={{height: '28px', fontSize: '12px'}}
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(server.id)}
                          className="polaris-btn polaris-btn-outline"
                          style={{width: '28px', height: '28px', padding: 0, color: 'var(--destructive)'}}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New MCP Server Form */}
          <div
            style={{
              padding: '18px',
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h4 style={{margin: '0', fontSize: '14.5px', fontWeight: 600, color: 'var(--foreground)'}}>
              Register Custom MCP Server
            </h4>

            {/* Transport Picker */}
            <div style={{display: 'flex', gap: '8px'}}>
              <button
                type="button"
                data-testid="mcp-transport-http"
                aria-pressed={transport === 'streamable_http'}
                onClick={() => setTransport('streamable_http')}
                className={`polaris-btn ${transport === 'streamable_http' ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                style={{height: '32px', fontSize: '12.5px', gap: '6px'}}
              >
                <Globe size={13} />
                HTTPS Streamable SSE
              </button>
              <button
                type="button"
                data-testid="mcp-transport-stdio"
                aria-pressed={transport === 'stdio'}
                onClick={() => setTransport('stdio')}
                className={`polaris-btn ${transport === 'stdio' ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                style={{height: '32px', fontSize: '12.5px', gap: '6px'}}
              >
                <Terminal size={13} />
                Stdio Command
              </button>
            </div>

            {/* Inputs */}
            <div>
              <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px'}}>
                Server Name
              </label>
              <input
                type="text"
                data-testid="mcp-server-name-input"
                placeholder="e.g. Memory Graph, Notion Tool"
                value={name}
                onChange={e => setName(e.target.value)}
                className="polaris-input"
              />
            </div>

            {transport === 'streamable_http' ? (
              <div>
                <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px'}}>
                  Endpoint URL
                </label>
                <input
                  type="text"
                  data-testid="mcp-server-endpoint-input"
                  placeholder="https://..."
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                  className="polaris-input"
                />
              </div>
            ) : (
              <div style={{display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px'}}>
                <div>
                  <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px'}}>
                    Command
                  </label>
                  <input
                    type="text"
                    data-testid="mcp-server-command-input"
                    placeholder="npx, python3, /usr/bin/..."
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    className="polaris-input"
                  />
                </div>
                <div>
                  <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px'}}>
                    Arguments
                  </label>
                  <input
                    type="text"
                    data-testid="mcp-server-args-input"
                    placeholder="-y @package/server ..."
                    value={args}
                    onChange={e => setArgs(e.target.value)}
                    className="polaris-input"
                  />
                </div>
              </div>
            )}

            {/* Bot Assignment */}
            <div>
              <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '6px'}}>
                Assign to Fleet Bots
              </label>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                {bots.map(b => {
                  const isAssigned = selectedBotIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-testid={`mcp-bot-assign-${b.id}`}
                      aria-pressed={isAssigned}
                      onClick={() => handleToggleBot(b.id)}
                      className={`polaris-btn ${isAssigned ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                      style={{height: '28px', fontSize: '12px', gap: '4px'}}
                    >
                      <BotIcon size={12} />
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', paddingTop: '8px'}}>
              <button
                type="button"
                data-testid="mcp-add-server-btn"
                onClick={handleAddServer}
                className="polaris-btn polaris-btn-primary"
                style={{height: '34px', fontSize: '13px', gap: '6px'}}
              >
                <Plus size={14} />
                Register MCP Server
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
