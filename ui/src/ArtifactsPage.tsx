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

const SEED_ARTIFACTS: ArtifactItem[] = [
  {
    id: 'art-sys-arch-01',
    botId: 'core-architect',
    name: 'architecture-diagram.html',
    description: 'Interactive HTML architecture and component layout for BalaBot core subsystem.',
    mimeType: 'text/html',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    version: 1,
    versionCount: 1,
    content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-top: 0; color: #38bdf8; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #0284c7; color: white; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
    .node { background: #0f172a; border: 1px solid #475569; border-radius: 8px; padding: 12px; }
    .node-title { font-weight: 600; font-size: 13px; color: #e2e8f0; }
    .node-desc { font-size: 12px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Polaris Architecture</span>
    <h1>BalaBot Hybrid Agent Subsystem</h1>
    <p>Real-time orchestrator connecting client event streams, local model runners, and tools.</p>
    <div class="grid">
      <div class="node">
        <div class="node-title">Client Shell</div>
        <div class="node-desc">React 18 SPA with Polaris navigation & dark token palette.</div>
      </div>
      <div class="node">
        <div class="node-title">FastAPI Server</div>
        <div class="node-desc">SSE streaming, session dispatch, and lifecycle hooks.</div>
      </div>
      <div class="node">
        <div class="node-title">Jev Governance</div>
        <div class="node-desc">Strict decision audit trail and intervention gating.</div>
      </div>
      <div class="node">
        <div class="node-title">Artifact Store</div>
        <div class="node-desc">Sandboxed HTML, PDF, Markdown & Attachment previews.</div>
      </div>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: 'art-polaris-spec-02',
    botId: 'ux-designer',
    name: 'polaris-rebase-spec.md',
    description: 'Detailed specification of the Polaris UI rebase design tokens, spacing rules, and parity goals.',
    mimeType: 'text/markdown',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    version: 2,
    versionCount: 2,
    content: `# Polaris UI Rebase Specification

## Design Invariants
1. **Sidebar Frame**: Exactly 316px fixed width on desktop (\`>= 1024px\`), -316px off-canvas drawer on mobile (\`< 1024px\`).
2. **Settings Overlay**: 7 distinct tabs (General, Models, Memory, Voice, Usage, Computer, Updates).
3. **Product Extras**: All BalaBot unique capabilities survive intact and remounted:
   - Skill Library -> Installed Skills tab inside Plugins overlay
   - Orphan Reconciliation -> Computer tab inside Settings overlay
   - Space Switcher -> Integrated conversation & bot management
4. **Color Tokens**: Zinc / Neutral dark palette with high-contrast text and accessible focus rings.

## Verification Checklist
- [x] Settings dialog with keyboard shortcuts (Esc)
- [x] API key persistence surviving hard reloads
- [x] Sandboxed iframe CSP with \`allow-scripts\` and script escape prevention
- [x] Full parity with upstream Polaris desktop layout
`,
  },
  {
    id: 'art-config-template-03',
    botId: 'infra-bot',
    name: 'agent-manifest.json',
    description: 'Declarative runtime manifest for autonomous agent execution and tool sandboxes.',
    mimeType: 'application/json',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    version: 1,
    versionCount: 1,
    content: JSON.stringify(
      {
        name: "balabot-autonomous-cluster",
        version: "2.4.0",
        orchestrator: {
          heartbeatIntervalMs: 5000,
          maxConcurrentSubagents: 4,
          timeoutSeconds: 300,
          governanceMode: "strict"
        },
        providers: {
          primary: "anthropic",
          fallback: "openai",
          temperature: 0.2
        },
        sandbox: {
          networkIsolation: true,
          readOnlyMounts: ["/etc/ssl/certs"],
          storageLimitMb: 1024
        }
      },
      null,
      2
    ),
  },
];

export function loadSavedArtifacts(): ArtifactItem[] {
  try {
    const raw = window.localStorage.getItem(ARTIFACTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return SEED_ARTIFACTS;
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
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90 select-none">
      {/* Top Header */}
      <header className="border-b border-border px-4 py-3 md:px-6 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateTo('/app')}
              className="flex shrink-0 items-center gap-1 rounded-lg py-1 px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              <span>Bots</span>
            </button>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Artifacts
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-mono">
              {filteredItems.length}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-pressed={filtersOpen}
              onClick={() => setFiltersOpen(open => !open)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                filtersOpen
                  ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Filter size={14} strokeWidth={2} />
              <span>Filters</span>
            </button>

            {!artifactId && (
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-background">
                <button
                  type="button"
                  aria-label="Card view"
                  aria-pressed={viewMode === 'grid'}
                  title="Card view"
                  onClick={() => handleSetViewMode('grid')}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <LayoutGrid size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  title="List view"
                  onClick={() => handleSetViewMode('list')}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    viewMode === 'list'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <List size={15} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter bar */}
        {filtersOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 pt-2 border-t border-border/50">
            <div className="relative w-full max-w-[260px]">
              <Search
                size={14}
                strokeWidth={2}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search artifacts…"
                className="w-full rounded-lg border border-border bg-background py-1.5 ps-8 pe-3 text-[13px] outline-none focus:border-ring focus:ring-1 focus:ring-ring text-foreground"
              />
            </div>

            <select
              aria-label="Filter by date"
              className="rounded-lg border border-border bg-background py-1.5 px-3 text-[13px] text-foreground outline-none focus:border-ring"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as DateFilter)}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>

            <button
              type="button"
              onClick={() => setActiveBotId(null)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                activeBotId === null
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              All bots
            </button>

            {bots.slice(0, 8).map(bot => (
              <button
                key={bot.id}
                type="button"
                onClick={() => setActiveBotId(bot.id === activeBotId ? null : bot.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  activeBotId === bot.id
                    ? 'bg-accent border-primary text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground'
                }`}
              >
                <BotAvatar identity={bot.id} color={bot.color} size={14} />
                <span className="max-w-[100px] truncate">{bot.name}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {artifactId ? (
          <>
            {!maximized && (
              <aside className="w-[320px] shrink-0 flex flex-col border-e border-border overflow-y-auto bg-card/20">
                <div className="p-3 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Artifacts ({filteredItems.length})
                </div>
                {filteredItems.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No artifacts found matching filters.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {filteredItems.map(item => (
                      <div
                        key={item.id}
                        onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                        className={`group relative p-3 cursor-pointer transition-colors ${
                          item.id === artifactId
                            ? 'bg-accent/70 text-accent-foreground'
                            : 'hover:bg-accent/30 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent/80 text-accent-foreground">
                            <ArtifactIcon mimeType={item.mimeType} small />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {item.name}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {mimeLabel(item.mimeType)}
                          </span>
                        </div>
                        {item.description && (
                          <p className="mt-1 ps-8 text-[11.5px] line-clamp-1 text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between ps-8 text-[11px] text-muted-foreground">
                          <span>{formatRelativeTime(item.createdAt)}</span>
                          <button
                            type="button"
                            title="Delete artifact"
                            onClick={e => {
                              e.stopPropagation();
                              setPendingDelete(item);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1 rounded transition-opacity"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            )}

            <main className="flex min-w-0 flex-1 flex-col bg-background">
              {selectedArtifact ? (
                <>
                  <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 bg-card/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-foreground">
                          {selectedArtifact.name}
                        </h2>
                        <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                          v{selectedArtifact.version}
                        </span>
                      </div>
                      {selectedArtifact.description && (
                        <p className="truncate text-xs text-muted-foreground mt-0.5">
                          {selectedArtifact.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadArtifact(selectedArtifact)}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        <Download size={14} />
                        <span>Download</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaximized(v => !v)}
                        title={maximized ? 'Show list' : 'Maximize'}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                      </button>
                    </div>
                  </header>

                  <div className="relative min-h-0 flex-1 p-4 overflow-hidden">
                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
                      <ArtifactPreviewRenderer artifact={selectedArtifact} />
                      {selectedArtifact.mimeType === 'text/html' && (
                        <div className="absolute bottom-3 end-3 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-[11px] text-zinc-200 border border-zinc-700/60 shadow-lg pointer-events-none">
                          <Lock size={12} className="text-amber-400" />
                          <span>Isolated preview — no access to account</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid h-full place-items-center text-muted-foreground text-sm">
                  Artifact not found or deleted.
                </div>
              )}
            </main>
          </>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {filteredItems.length === 0 ? (
              <div className="grid min-h-[300px] place-items-center text-center">
                <div className="flex flex-col items-center gap-2 max-w-sm">
                  <AlertCircle size={32} className="text-muted-foreground/60" />
                  <p className="text-base font-medium text-foreground">No artifacts found</p>
                  <p className="text-xs text-muted-foreground">
                    Artifacts generated by agents or uploaded as attachments will appear here.
                  </p>
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-4 hover:border-ring/50 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                          <ArtifactIcon mimeType={item.mimeType} />
                        </span>
                        <div className="flex items-center gap-1.5">
                          {item.versionCount > 1 && (
                            <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              v{item.version}
                            </span>
                          )}
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            {mimeLabel(item.mimeType)}
                          </span>
                        </div>
                      </div>

                      <h3 className="mt-3 truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {item.name}
                      </h3>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {item.botId && (
                          <>
                            <BotAvatar identity={item.botId} size={16} />
                            <span className="truncate max-w-[120px] font-medium text-foreground/80">
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
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1 rounded transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    className="group relative flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer"
                    onClick={() => navigateTo(`/app/artifacts/${item.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                        <ArtifactIcon mimeType={item.mimeType} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {mimeLabel(item.mimeType)}
                          </span>
                        </div>
                        {item.description && (
                          <p className="truncate text-xs text-muted-foreground mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 ms-4">
                      {item.botId && (
                        <div className="hidden sm:flex items-center gap-1.5">
                          <BotAvatar identity={item.botId} size={14} />
                          <span className="truncate max-w-[100px]">
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
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1.5 rounded transition-opacity"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Delete "{pendingDelete.name}"?
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete this artifact and its versions. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={confirmDelete}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm"
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
      <div className="h-full overflow-y-auto bg-background p-6">
        <article className="mx-auto max-w-[760px] text-foreground leading-relaxed">
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
      <div className="grid h-full place-items-center overflow-auto bg-muted/30 p-6">
        <img src={src} alt={artifact.name} className="max-h-full max-w-full rounded-lg shadow-sm object-contain" />
      </div>
    );
  }

  // Fallback for code/JSON/text
  const text = artifact.content ?? (artifact.contentBase64 ? atob(artifact.contentBase64) : '');
  return (
    <div className="h-full overflow-y-auto bg-zinc-950 p-6 font-mono text-xs text-zinc-200">
      <pre className="whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function ArtifactIcon({ mimeType, small }: { mimeType: string; small?: boolean }) {
  const size = small ? 14 : 18;
  if (mimeType === 'text/html') return <FileCode size={size} className="text-amber-400" />;
  if (mimeType === 'text/markdown') return <FileText size={size} className="text-sky-400" />;
  if (mimeType === 'application/pdf') return <FileText size={size} className="text-rose-400" />;
  if (mimeType === 'application/json') return <FileCode size={size} className="text-emerald-400" />;
  return <FileText size={size} className="text-muted-foreground" />;
}
