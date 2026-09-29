import {useState} from 'react';
import {getAgents, type AgentNode} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';
import {BotAvatar} from '../BotAvatar';

const flatten = (nodes: AgentNode[], out: AgentNode[] = []): AgentNode[] => {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
};

const tierLabel: Record<AgentNode['tier'], string> = {
  user: 'User',
  principal: 'Principal',
  governor: 'Governor',
  persistent: 'Persistent agent',
  sub: 'Sub-agent',
};

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: AgentNode;
  depth: number;
  selectedId: string;
  onSelect: (node: AgentNode) => void;
}) {
  const isSelected = node.id === selectedId;
  const isLive = node.status === 'live';
  const isBusy = node.status === 'busy';

  return (
    <div style={{display: 'flex', flexDirection: 'column'}}>
      <button
        type="button"
        onClick={() => onSelect(node)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 12px',
          paddingLeft: `${depth * 24 + 14}px`,
          borderRadius: 'var(--radius-md, 8px)',
          border: 'none',
          backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
          color: 'var(--foreground)',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'background-color 120ms ease',
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={e => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--muted)';
        }}
        onMouseLeave={e => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <BotAvatar
          identity={node.id}
          color={node.tier === 'governor' ? 'purple' : node.tier === 'principal' ? 'blue' : 'teal'}
          size={26}
          status={isBusy ? 'working' : undefined}
        />
        <div style={{display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <span style={{fontSize: '13.5px', fontWeight: 600, color: 'var(--foreground)'}}>
              {node.name}
            </span>
            <span
              style={{
                backgroundColor: 'var(--muted)',
                color: 'var(--muted-foreground)',
                padding: '1px 6px',
                borderRadius: '9999px',
                fontSize: '10.5px',
                fontWeight: 500,
              }}
            >
              {tierLabel[node.tier] || node.tier}
            </span>
          </div>
          <span style={{fontSize: '12px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
            {node.role}
          </span>
        </div>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '9999px',
            backgroundColor: isLive ? 'var(--success)' : isBusy ? 'var(--warning)' : 'var(--muted-foreground)',
            flexShrink: 0,
          }}
          title={node.status}
        />
      </button>

      {node.children && node.children.length > 0 ? (
        <div style={{display: 'flex', flexDirection: 'column', position: 'relative'}}>
          <div
            style={{
              position: 'absolute',
              left: `${depth * 24 + 26}px`,
              top: 0,
              bottom: '8px',
              width: '1px',
              backgroundColor: 'var(--border)',
            }}
          />
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Polaris AgentsScreen:
 * Full-page hierarchical agent tree (User → Principal → Governor → Persistent Agents → Sub-Agents)
 * with live status counts and detail inspector, consuming Polaris token variables and .rk-scroll.
 */
export function AgentsScreen() {
  const state = useApiData(getAgents);
  const agentTree: AgentNode[] = state.phase === 'ready' ? state.data.tree ?? [] : [];
  const all = flatten(agentTree);
  const [selectedNode, setSelectedNode] = useState<AgentNode | null>(null);

  const selected = selectedNode ?? all[1] ?? all[0];
  const live = all.filter(a => a.status === 'live').length;

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: 'var(--background)', color: 'var(--foreground)'}}>
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        <h2 style={{margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--foreground)'}}>
          Agents Fleet
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `User → principal → governor → persistent agents → sub-agents. ${live} live of ${all.length} agents.`
            : 'The agent hierarchy this install actually runs.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && agentTree.length > 0 ? (
        <div style={{display: 'flex', flex: 1, minHeight: 0}}>
          {/* Hierarchical Tree List */}
          <div
            className="rk-scroll"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {agentTree.map(node => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={selected?.id ?? ''}
                onSelect={setSelectedNode}
              />
            ))}
          </div>

          {/* Agent Detail Panel */}
          {selected ? (
            <div
              className="rk-scroll"
              style={{
                width: '320px',
                borderLeft: '1px solid var(--border)',
                backgroundColor: 'var(--card)',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                flexShrink: 0,
                overflowY: 'auto',
              }}
            >
              <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                <BotAvatar
                  identity={selected.id}
                  color={selected.tier === 'governor' ? 'purple' : selected.tier === 'principal' ? 'blue' : 'teal'}
                  size={44}
                />
                <div>
                  <h3 style={{margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--foreground)'}}>
                    {selected.name}
                  </h3>
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: '4px',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--link)',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {tierLabel[selected.tier]}
                  </span>
                </div>
              </div>

              <div>
                <span style={{fontSize: '11.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)'}}>
                  Role & Mission
                </span>
                <p style={{margin: '6px 0 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--foreground)'}}>
                  {selected.role}
                </p>
              </div>

              <div style={{borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px'}}>
                <span style={{fontSize: '11.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)'}}>
                  Status Metadata
                </span>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px'}}>
                  <span style={{color: 'var(--muted-foreground)'}}>State:</span>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '9999px',
                        backgroundColor:
                          selected.status === 'live'
                            ? 'var(--success)'
                            : selected.status === 'busy'
                              ? 'var(--warning)'
                              : 'var(--muted-foreground)',
                      }}
                    />
                    <span style={{fontWeight: 500, color: 'var(--foreground)'}}>{selected.status}</span>
                  </div>
                </div>

                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px'}}>
                  <span style={{color: 'var(--muted-foreground)'}}>Tier:</span>
                  <span style={{fontWeight: 500, color: 'var(--foreground)'}}>{tierLabel[selected.tier]}</span>
                </div>

                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px'}}>
                  <span style={{color: 'var(--muted-foreground)'}}>Fleet size:</span>
                  <span style={{fontWeight: 500, color: 'var(--foreground)', fontFamily: 'var(--font-family-code, monospace)'}}>
                    {all.length} agents
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <ApiNotice state={state} />
      )}
    </div>
  );
}