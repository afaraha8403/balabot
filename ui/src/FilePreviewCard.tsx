import {useState} from 'react';
import {Text} from '@astryxdesign/core/Text';
import {IconFile} from './icons';
import type {Attachment} from './api';

type Props = {
  attachment: Attachment;
  onDownload?: (att: Attachment) => void;
};

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(name: string, mime?: string): boolean {
  if (mime && mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isCodeOrText(name: string): boolean {
  return /\.(py|ts|tsx|js|jsx|json|md|txt|sh|html|css|yaml|yml|sql|rs|go|c|cpp|h)$/i.test(name);
}

/**
 * FilePreviewCard: mirrors Polaris ArtifactFileCard structure, tokens, and rhythm.
 * Provides rich file header with icon, filename, size, download affordance,
 * and expandable code/image preview.
 */
export function FilePreviewCard({attachment, onDownload}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isImg = isImage(attachment.name, attachment.mime_type);
  const isCode = isCodeOrText(attachment.name);
  const sizeLabel = formatSize(attachment.size);

  const handleDownload = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onDownload) {
      onDownload(attachment);
      return;
    }
    const link = document.createElement('a');
    link.href = attachment.url || attachment.path || '#';
    link.download = attachment.name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 'var(--preview-card-min-width, 17.5rem)',
        maxWidth: 'var(--preview-card-max-width, 28.75rem)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        color: 'var(--foreground)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'space-between',
        }}
      >
        {/* Clickable preview target */}
        <button
          type="button"
          aria-label={`Preview ${attachment.name}`}
          onClick={() => (isImg || isCode) && setIsExpanded(prev => !prev)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-3)',
            padding: 'var(--spacing-3) var(--spacing-4)',
            background: 'none',
            border: 'none',
            color: 'inherit',
            textAlign: 'left',
            cursor: isImg || isCode ? 'pointer' : 'default',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 'var(--spacing-10)',
              height: 'var(--spacing-10)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--muted)',
              color: 'var(--foreground)',
              flexShrink: 0,
            }}
          >
            <IconFile size="md" />
          </span>
          <span style={{minWidth: 0, flex: 1}}>
            <span
              style={{
                display: 'block',
                fontWeight: 500,
                fontSize: 'var(--font-size-sm)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment.name}
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 'var(--spacing-0-5)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--muted-foreground)',
              }}
            >
              {attachment.mime_type ? `${attachment.mime_type} · ` : ''}
              {sizeLabel || 'Attachment'}
            </span>
          </span>
        </button>

        {/* Dedicated download action */}
        <button
          type="button"
          aria-label={`Download ${attachment.name}`}
          title={`Download ${attachment.name}`}
          onClick={handleDownload}
          style={{
            width: 'var(--spacing-14)',
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            borderLeft: '1px solid var(--border)',
            background: 'none',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            transition: 'background-color 150ms ease, color 150ms ease',
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
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      {/* Rich preview */}
      {isImg && (attachment.url || attachment.path) ? (
        <div style={{padding: '0 var(--spacing-3) var(--spacing-3) var(--spacing-3)', textAlign: 'center'}}>
          <img
            src={attachment.url || attachment.path}
            alt={attachment.name}
            style={{
              width: '100%',
              maxHeight: isExpanded ? '37.5rem' : '11.25rem',
              objectFit: 'contain',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              backgroundColor: 'var(--secondary)',
            }}
            onClick={() => setIsExpanded(prev => !prev)}
          />
          <Text type="supporting" size="xsm" color="secondary">
            {isExpanded ? 'Click image to collapse' : 'Click image to expand'}
          </Text>
        </div>
      ) : null}

      {isCode ? (
        <div
          className="rk-scroll"
          style={{
            margin: '0 var(--spacing-3) var(--spacing-3) var(--spacing-3)',
            padding: 'var(--spacing-2-5) var(--spacing-3)',
            fontFamily: 'var(--font-family-code, monospace)',
            fontSize: 'var(--font-size-xs)',
            backgroundColor: 'var(--secondary)',
            borderRadius: 'var(--radius-sm)',
            overflowX: 'auto',
            maxHeight: isExpanded ? '25rem' : '8.75rem',
          }}
        >
          <Text type="supporting" size="xsm" color="secondary">
            Code preview ({attachment.name.split('.').pop()?.toUpperCase()})
          </Text>
        </div>
      ) : null}
    </div>
  );
}
