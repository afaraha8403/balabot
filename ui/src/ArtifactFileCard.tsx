import { useState, useEffect, useRef } from 'react';
import { Code2, Download, FileText, Image as ImageIcon, X } from 'lucide-react';
import { SandboxedHtmlViewer } from './SandboxedHtmlViewer';
import { PdfViewer } from './PdfViewer';
import { ChatMarkdown } from './ChatMarkdown';
import type { Attachment } from './api';

export type ArtifactFileCardProps = {
  attachment?: Attachment;
  artifactId?: string;
  name: string;
  mimeType?: string;
  size?: number;
  url?: string;
  path?: string;
  onDownload?: (att?: Attachment) => void;
};

const PREVIEWABLE_MIME_TYPES = new Set([
  'text/markdown',
  'text/html',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
]);

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(name: string, mime?: string): boolean {
  if (mime && mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

function isPdf(name: string, mime?: string): boolean {
  if (mime === 'application/pdf') return true;
  return /\.pdf$/i.test(name);
}

function isHtml(name: string, mime?: string): boolean {
  if (mime === 'text/html') return true;
  return /\.(html|htm)$/i.test(name);
}

function isCodeOrText(name: string, mime?: string): boolean {
  if (mime && (mime.startsWith('text/') || mime === 'application/json')) return true;
  return /\.(py|ts|tsx|js|jsx|json|md|txt|sh|html|css|yaml|yml|sql|rs|go|c|cpp|h)$/i.test(name);
}

/**
 * Polaris ArtifactFileCard component for rich file preview cards
 * with full-screen modal previews for PDF, sandboxed HTML, images,
 * and markdown/code documents.
 */
export function ArtifactFileCard(props: ArtifactFileCardProps) {
  const {
    attachment,
    name,
    mimeType = attachment?.mime_type || '',
    size = attachment?.size,
    url = attachment?.url || attachment?.path || '',
    onDownload,
  } = props;

  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const isImg = isImage(name, mimeType);
  const isDocPdf = isPdf(name, mimeType);
  const isDocHtml = isHtml(name, mimeType);
  const isDocCode = isCodeOrText(name, mimeType);
  const previewable = isImg || isDocPdf || isDocHtml || isDocCode || PREVIEWABLE_MIME_TYPES.has(mimeType);

  const startDownload = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDownloadError(null);
    try {
      if (onDownload) {
        onDownload(attachment);
        return;
      }
      const link = document.createElement('a');
      link.href = url || '#';
      link.download = name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setDownloadError(`Could not download ${name}. Try again.`);
    }
  };

  const renderIcon = () => {
    if (isImg) return <ImageIcon size={21} strokeWidth={1.8} />;
    if (isDocHtml || isDocCode) return <Code2 size={21} strokeWidth={1.8} />;
    return <FileText size={21} strokeWidth={1.8} />;
  };

  return (
    <>
      <div data-testid="artifact-file-card" className="flex flex-col">
        <div className="flex min-w-[280px] max-w-[460px] overflow-hidden rounded-2xl border border-border bg-card text-left text-foreground shadow-sm">
          <button
            type="button"
            aria-label={`Preview ${name}`}
            disabled={!previewable}
            onClick={() => setPreviewOpen(true)}
            className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors ${
              previewable ? 'hover:bg-accent cursor-pointer' : 'cursor-default'
            }`}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
              {renderIcon()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-foreground">{name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {mimeType ? `${mimeType} · ` : ''}
                {formatBytes(size) || 'Attachment'}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={`Download ${name}`}
            title={`Download ${name}`}
            onClick={startDownload}
            className="grid w-14 shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Download size={19} strokeWidth={1.8} />
          </button>
        </div>
        {downloadError ? (
          <div role="alert" className="mt-2 text-left text-[13px] text-red-500">
            {downloadError}
          </div>
        ) : null}
      </div>

      {previewOpen ? (
        <ArtifactModalPreview
          name={name}
          url={url}
          mimeType={mimeType}
          isImg={isImg}
          isPdf={isDocPdf}
          isHtml={isDocHtml}
          onClose={() => setPreviewOpen(false)}
          onDownload={startDownload}
        />
      ) : null}
    </>
  );
}

function ArtifactModalPreview({
  name,
  url,
  mimeType,
  isImg,
  isPdf: docIsPdf,
  isHtml: docIsHtml,
  onClose,
  onDownload,
}: {
  name: string;
  url: string;
  mimeType: string;
  isImg: boolean;
  isPdf: boolean;
  isHtml: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | undefined>(undefined);
  const [loading, setLoading] = useState(!isImg);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isImg) return;
    if (!url) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (docIsPdf) {
          const buffer = await res.arrayBuffer();
          if (!cancelled) setPdfBytes(new Uint8Array(buffer));
        } else {
          const text = await res.text();
          if (!cancelled) setContent(text);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load preview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, docIsPdf, isImg]);

  return (
    <div
      className="polaris-dialog-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="polaris-dialog-content flex h-[min(88vh,900px)] w-[min(960px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${name}`}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 bg-card">
          <h2 className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-foreground">
            {name}
          </h2>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label={`Download ${name}`}
            title={`Download ${name}`}
            onClick={onDownload}
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close preview"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto bg-background">
          {loading ? (
            <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
              Loading preview…
            </div>
          ) : error ? (
            <div className="m-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
              {error}
            </div>
          ) : isImg ? (
            <div className="flex h-full w-full items-center justify-center p-6 bg-muted/30">
              <img
                src={url}
                alt={name}
                className="max-h-full max-w-full rounded-lg object-contain shadow-md"
              />
            </div>
          ) : docIsHtml && content !== null ? (
            <SandboxedHtmlViewer html={content} title={name} />
          ) : docIsPdf ? (
            <PdfViewer bytes={pdfBytes} url={url} title={name} />
          ) : content !== null ? (
            <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[15px] leading-7 text-foreground">
              <ChatMarkdown>{content}</ChatMarkdown>
            </article>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
              No preview available for this file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
