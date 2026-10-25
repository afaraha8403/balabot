import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  Download,
  Filter,
  LayoutGrid,
  List,
  Lock,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  FileCode,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { SandboxedHtmlViewer } from './SandboxedHtmlViewer';
import { PdfViewer } from './PdfViewer';
import { ChatMarkdown } from './ChatMarkdown';
import { BotAvatar } from './BotAvatar';
import { navigateTo } from './router';
import type { Bot } from './api';

export type ViewMode = 'grid' | 'list';
export type DateFilter = 'all' | 'today' | 'week' | 'month';

export type ArtifactItem = {
  id: string;
  botId?: string;
  name: string;
  description?: string;
  mimeType: string;
  createdAt: string;
  updatedAt?: string;
  version: number;
  versionCount: number;
  content?: string;
  contentBase64?: string;
  url?: string;
  size?: number;
};

const VIEW_MODE_STORAGE_KEY = 'balabot:artifacts-view-mode';
const ARTIFACTS_STORAGE_KEY = 'balabot:artifacts';

function readViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {}
}

export function loadSavedArtifacts(): ArtifactItem[] {
  try {
    const raw = window.localStorage.getItem(ARTIFACTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveArtifacts(items: ArtifactItem[]): void {
  try {
    window.localStorage.setItem(ARTIFACTS_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function formatRelativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - then) / 1000));
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
}

function matchesCalendarDateFilter(iso: string, filter: DateFilter, now: Date): boolean {
  if (filter === 'all') return true;
  const date = new Date(iso);
  if (filter === 'today') return date.toDateString() === now.toDateString();
  if (filter === 'week') {
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    return date >= startOfWeek;
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function mimeLabel(mimeType: string): string {
  if (mimeType === 'text/html') return 'HTML';
  if (mimeType === 'text/markdown') return 'MD';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/json') return 'JSON';
  const slash = mimeType.indexOf('/');
  return (slash === -1 ? mimeType : mimeType.slice(slash + 1)).toUpperCase().slice(0, 6);
}

function downloadArtifact(artifact: ArtifactItem) {
  if (artifact.url) {
    const a = document.createElement('a');
    a.href = artifact.url;
    a.download = artifact.name;
    a.click();
    return;
  }
  let blob: Blob;
  if (artifact.contentBase64) {
    const byteCharacters = atob(artifact.contentBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    blob = new Blob([byteArray], { type: artifact.mimeType });
  } else {
    blob = new Blob([artifact.content ?? ''], { type: artifact.mimeType });
  }
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = artifact.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function ArtifactsPage({
  artifactId,
  bots = [],
}: {
  artifactId?: string;
  bots?: Bot[];
}) {
  const [items, setItems] = useState<ArtifactItem[]>(() => loadSavedArtifacts());
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [maximized, setMaximized] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ArtifactItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setMaximized(false);
  }, [artifactId]);

  const botsById = useMemo(() => new Map(bots.map(b => [b.id, b])), [bots]);

  const filteredItems = useMemo(() => {
    const now = new Date();
    const query = searchQuery.trim().toLowerCase();
    return items.filter(item => {
      if (activeBotId && item.botId !== activeBotId) return false;
      if (!matchesCalendarDateFilter(item.createdAt, dateFilter, now)) return false;
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        (item.description?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [items, searchQuery, dateFilter, activeBotId]);

  function handleSetViewMode(mode: ViewMode) {
    setViewMode(mode);
    writeViewMode(mode);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    const updated = items.filter(i => i.id !== pendingDelete.id);
    setItems(updated);
    saveArtifacts(updated);
    setDeleteBusy(false);
    setPendingDelete(null);
    if (artifactId === pendingDelete.id) {
      navigateTo('/app/artifacts');
    }
  }

  const selectedArtifact = useMemo(() => {
    if (!artifactId) return null;
    return items.find(i => i.id === artifactId) ?? null;
  }, [items, artifactId]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minWidth: 0,
        flexDirection: 'column',
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        userSelect: 'none',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          padding: '12px 20px',
          backgroundColor: 'var(--card)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => navigateTo('/app')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                borderRadius: 'var(--radius-md, 8px)',
                padding: '4px 8px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--muted-foreground)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 120ms ease, color 120ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'var(--accent)';
                e.currentTarget.style.color = 'var(--foreground)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--muted-foreground)';
              }}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              <span>Bots</span>
            </button>
            <div style={{ height: '16px', width: '1px', backgroundColor: 'var(--border)' }} />
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--foreground)' }}>
              Artifacts
            </h1>
            <span
              style={{
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '9999px',
                backgroundColor: 'var(--accent)',
                color: 'var(--foreground)',
                fontFamily: 'monospace',
                fontWeight: 500,
              }}
            >
              {filteredItems.length}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              aria-pressed={filtersOpen}
              onClick={() => setFiltersOpen(open => !open)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: 'var(--radius-md, 8px)',
                border: filtersOpen ? '1px solid var(--primary)' : '1px solid var(--border)',
                backgroundColor: filtersOpen ? 'var(--primary)' : 'transparent',
                color: filtersOpen ? 'var(--primary-foreground)' : 'var(--foreground)',
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 120ms ease',
              }}
            >
              <Filter size={14} strokeWidth={2} />
              <span>Filters</span>
            </button>

            {!artifactId && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  padding: '2px',
                  backgroundColor: 'var(--background)',
                }}
              >
                <button
                  type="button"
                  aria-label="Card view"
                  aria-pressed={viewMode === 'grid'}
                  title="Card view"
                  onClick={() => handleSetViewMode('grid')}
                  style={{
                    display: 'flex',
                    height: '28px',
                    width: '28px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-sm, 6px)',
                    border: 'none',
                    backgroundColor: viewMode === 'grid' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'grid' ? 'var(--foreground)' : 'var(--muted-foreground)',
                    cursor: 'pointer',
                  }}
                >
                  <LayoutGrid size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  title="List view"
                  onClick={() => handleSetViewMode('list')}
                  style={{
                    display: 'flex',
                    height: '28px',
                    width: '28px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-sm, 6px)',
                    border: 'none',
                    backgroundColor: viewMode === 'list' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'list' ? 'var(--foreground)' : 'var(--muted-foreground)',
                    cursor: 'pointer',
                  }}
                >
                  <List size={15} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        {filtersOpen && (
          <div
            style={{
              marginTop: '12px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '10px',
              paddingTop: '10px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <div style={{ position: 'relative', width: '100%', maxWidth: '260px' }}>
              <Search
                size={14}
                strokeWidth={2}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted-foreground)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search artifacts…"
                style={{
                  width: '100%',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--background)',
                  padding: '6px 12px 6px 30px',
                  fontSize: '13px',
                  color: 'var(--foreground)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <select
              aria-label="Filter by date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as DateFilter)}
              style={{
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--background)',
                padding: '6px 12px',
                fontSize: '13px',
                color: 'var(--foreground)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>

            <button
              type="button"
              onClick={() => setActiveBotId(null)}
              style={{
                borderRadius: '9999px',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 500,
                border: activeBotId === null ? '1px solid var(--primary)' : '1px solid var(--border)',
                backgroundColor: activeBotId === null ? 'var(--primary)' : 'transparent',
                color: activeBotId === null ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                cursor: 'pointer',
                transition: 'all 120ms ease',
              }}
            >
              All bots
            </button>

            {bots.slice(0, 8).map(bot => {
              const isSelected = activeBotId === bot.id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => setActiveBotId(isSelected ? null : bot.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '9999px',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                    backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
                    color: isSelected ? 'var(--foreground)' : 'var(--muted-foreground)',
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 120ms ease',
                  }}
                >
                  <BotAvatar identity={bot.id} color={bot.color} size={14} />
                  <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bot.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div style={{ display: 'flex', minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {artifactId ? (
          <>
            {!maximized && (
              <aside
                className="rk-scroll"
                style={{
                  width: '320px',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRight: '1px solid var(--border)',
                  overflowY: 'auto',
                  backgroundColor: 'var(--card)',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--muted-foreground)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Artifacts ({filteredItems.length})
                </div>
                {filteredItems.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--muted-foreground)' }}>
                    No artifacts found matching filters.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredItems.map(item => {
                      const isSelected = item.id === artifactId;
                      return (
                        <div
                          key={item.id}
                          onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                            backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
                            transition: 'background-color 100ms ease',
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--muted)';
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                width: '24px',
                                height: '24px',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 'var(--radius-sm, 6px)',
                                backgroundColor: 'var(--accent)',
                                color: 'var(--foreground)',
                                flexShrink: 0,
                              }}
                            >
                              <ArtifactIcon mimeType={item.mimeType} small />
                            </span>
                            <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500 }}>
                              {item.name}
                            </span>
                            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                              {mimeLabel(item.mimeType)}
                            </span>
                          </div>
                          {item.description && (
                            <p style={{ margin: '4px 0 0 32px', fontSize: '11.5px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.description}
                            </p>
                          )}
                          <div style={{ marginTop: '6px', paddingLeft: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                            <button
                              type="button"
                              title="Delete artifact"
                              onClick={e => {
                                e.stopPropagation();
                                setPendingDelete(item);
                              }}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--muted-foreground)',
                                cursor: 'pointer',
                                padding: '2px',
                                borderRadius: '4px',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--destructive)')}
                              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </aside>
            )}

            <main style={{ display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column', backgroundColor: 'var(--background)' }}>
              {selectedArtifact ? (
                <>
                  <header
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      borderBottom: '1px solid var(--border)',
                      padding: '12px 24px',
                      backgroundColor: 'var(--card)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedArtifact.name}
                        </h2>
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                          v{selectedArtifact.version}
                        </span>
                      </div>
                      {selectedArtifact.description && (
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedArtifact.description}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => downloadArtifact(selectedArtifact)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          borderRadius: 'var(--radius-md, 8px)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'transparent',
                          color: 'var(--foreground)',
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        <Download size={14} />
                        <span>Download</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaximized(v => !v)}
                        title={maximized ? 'Show list' : 'Maximize'}
                        style={{
                          display: 'flex',
                          width: '32px',
                          height: '32px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 'var(--radius-md, 8px)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'transparent',
                          color: 'var(--muted-foreground)',
                          cursor: 'pointer',
                        }}
                      >
                        {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                      </button>
                    </div>
                  </header>

                  <div style={{ position: 'relative', minHeight: 0, flex: 1, padding: '16px', overflow: 'hidden', boxSizing: 'border-box' }}>
                    <div
                      style={{
                        position: 'relative',
                        height: '100%',
                        width: '100%',
                        overflow: 'hidden',
                        borderRadius: 'var(--radius-lg, 12px)',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--card)',
                        boxSizing: 'border-box',
                      }}
                    >
                      <ArtifactPreviewRenderer artifact={selectedArtifact} />
                      {selectedArtifact.mimeType === 'text/html' && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '12px',
                            right: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: '9999px',
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            padding: '4px 12px',
                            fontSize: '11px',
                            color: '#e4e4e7',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            pointerEvents: 'none',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                          }}
                        >
                          <Lock size={12} style={{ color: 'var(--warning, #eab308)' }} />
                          <span>Isolated sandbox preview</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ display: 'grid', height: '100%', placeItems: 'center', color: 'var(--muted-foreground)', fontSize: '14px' }}>
                  Artifact not found or deleted.
                </div>
              )}
            </main>
          </>
        ) : (
          <main className="rk-scroll" style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '24px' }}>
            {filteredItems.length === 0 ? (
              <div style={{ display: 'grid', minHeight: '320px', placeItems: 'center', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', maxWidth: '380px' }}>
                  <AlertCircle size={32} style={{ color: 'var(--muted-foreground)', opacity: 0.7 }} />
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--foreground)' }}>
                    No artifacts generated yet
                  </p>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                    Files, diagrams, and exports generated during agent runs will be organized here.
                  </p>
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px',
                }}
              >
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      borderRadius: 'var(--radius-lg, 12px)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--card)',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'border-color 120ms ease, box-shadow 120ms ease',
                    }}
                    onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--ring)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            width: '36px',
                            height: '36px',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'var(--radius-md, 8px)',
                            backgroundColor: 'var(--accent)',
                            color: 'var(--foreground)',
                          }}
                        >
                          <ArtifactIcon mimeType={item.mimeType} />
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {item.versionCount > 1 && (
                            <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                              v{item.version}
                            </span>
                          )}
                          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                            {mimeLabel(item.mimeType)}
                          </span>
                        </div>
                      </div>

                      <h3 style={{ margin: '12px 0 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </h3>
                      {item.description && (
                        <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--muted-foreground)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {item.description}
                        </p>
                      )}
                    </div>

                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        {item.botId && (
                          <>
                            <BotAvatar identity={item.botId} size={16} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px', fontWeight: 500, color: 'var(--foreground)' }}>
                              {botsById.get(item.botId)?.name ?? item.botId}
                            </span>
                            <span>·</span>
                          </>
                        )}
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </div>

                      <button
                        type="button"
                        aria-label={`Delete ${item.name}`}
                        title={`Delete ${item.name}`}
                        onClick={e => {
                          e.stopPropagation();
                          setPendingDelete(item);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--muted-foreground)',
                          cursor: 'pointer',
                          padding: '4px',
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--destructive)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)', overflow: 'hidden' }}>
                {filteredItems.map((item, idx) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderBottom: idx < filteredItems.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 100ms ease',
                    }}
                    onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          width: '32px',
                          height: '32px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 'var(--radius-md, 8px)',
                          backgroundColor: 'var(--accent)',
                          color: 'var(--foreground)',
                          flexShrink: 0,
                        }}
                      >
                        <ArtifactIcon mimeType={item.mimeType} />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </span>
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                            {mimeLabel(item.mimeType)}
                          </span>
                        </div>
                        {item.description && (
                          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--muted-foreground)', flexShrink: 0, marginLeft: '16px' }}>
                      {item.botId && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <BotAvatar identity={item.botId} size={14} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100px' }}>
                            {botsById.get(item.botId)?.name ?? item.botId}
                          </span>
                        </div>
                      )}
                      <span>{formatRelativeTime(item.createdAt)}</span>

                      <button
                        type="button"
                        aria-label={`Delete ${item.name}`}
                        title={`Delete ${item.name}`}
                        onClick={e => {
                          e.stopPropagation();
                          setPendingDelete(item);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--muted-foreground)',
                          cursor: 'pointer',
                          padding: '4px',
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--destructive)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {pendingDelete && (
        <div
          className="polaris-dialog-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--overlay)',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              borderRadius: 'var(--radius-xl, 16px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: 'var(--foreground)' }}>
              Delete "{pendingDelete.name}"?
            </h3>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
              This will permanently delete this artifact and its versions. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', paddingTop: '8px' }}>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setPendingDelete(null)}
                className="polaris-btn polaris-btn-outline"
                style={{ height: '34px', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={confirmDelete}
                className="polaris-btn polaris-btn-destructive"
                style={{ height: '34px', fontSize: '13px' }}
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactPreviewRenderer({ artifact }: { artifact: ArtifactItem }) {
  if (artifact.mimeType === 'text/html') {
    const html = artifact.content ?? (artifact.contentBase64 ? atob(artifact.contentBase64) : '');
    return <SandboxedHtmlViewer html={html} title={artifact.name} />;
  }

  if (artifact.mimeType === 'text/markdown') {
    const text = artifact.content ?? (artifact.contentBase64 ? atob(artifact.contentBase64) : '');
    return (
      <div className="rk-scroll" style={{ height: '100%', overflowY: 'auto', backgroundColor: 'var(--background)', padding: '24px' }}>
        <article style={{ margin: '0 auto', maxWidth: '760px', color: 'var(--foreground)', lineHeight: 1.6 }}>
          <ChatMarkdown>{text}</ChatMarkdown>
        </article>
      </div>
    );
  }

  if (artifact.mimeType === 'application/pdf') {
    return <PdfViewer url={artifact.url} title={artifact.name} />;
  }

  if (artifact.mimeType.startsWith('image/')) {
    const src = artifact.url || (artifact.contentBase64 ? `data:${artifact.mimeType};base64,${artifact.contentBase64}` : '');
    return (
      <div style={{ display: 'grid', height: '100%', placeItems: 'center', overflow: 'auto', backgroundColor: 'var(--muted)', padding: '24px' }}>
        <img src={src} alt={artifact.name} style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: 'var(--radius-md, 8px)', objectFit: 'contain' }} />
      </div>
    );
  }

  // Fallback for code/JSON/text
  const text = artifact.content ?? (artifact.contentBase64 ? atob(artifact.contentBase64) : '');
  return (
    <div className="rk-scroll" style={{ height: '100%', overflowY: 'auto', backgroundColor: 'var(--card)', padding: '24px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--foreground)' }}>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</pre>
    </div>
  );
}

function ArtifactIcon({ mimeType, small }: { mimeType: string; small?: boolean }) {
  const size = small ? 14 : 18;
  if (mimeType === 'text/html') return <FileCode size={size} style={{ color: '#f59e0b' }} />;
  if (mimeType === 'text/markdown') return <FileText size={size} style={{ color: '#0284c7' }} />;
  if (mimeType === 'application/pdf') return <FileText size={size} style={{ color: '#ef4444' }} />;
  if (mimeType === 'application/json') return <FileCode size={size} style={{ color: '#10b981' }} />;
  return <FileText size={size} style={{ color: 'var(--muted-foreground)' }} />;
}
