import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Token} from '@astryxdesign/core/Token';
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

export function FilePreviewCard({attachment, onDownload}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isImg = isImage(attachment.name, attachment.mime_type);
  const isCode = isCodeOrText(attachment.name);
  const sizeLabel = formatSize(attachment.size);

  const handleDownload = () => {
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
    <Card variant="muted" padding={2} style={{maxWidth: 420}}>
      <VStack gap={2}>
        {/* Header with icon, filename and size */}
        <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
          <HStack gap={1} vAlign="center">
            <IconFile size="sm" color="secondary" />
            <Text type="body" weight="medium" size="sm">
              {attachment.name}
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            {sizeLabel ? <Token label={sizeLabel} size="sm" /> : null}
            <Button
              label="Download"
              size="sm"
              variant="ghost"
              onClick={handleDownload}
            />
          </HStack>
        </HStack>

        {/* Rich preview */}
        {isImg && (attachment.url || attachment.path) ? (
          <VStack gap={1} align="center">
            <img
              src={attachment.url || attachment.path}
              alt={attachment.name}
              style={{
                width: '100%',
                maxHeight: isExpanded ? '600px' : '160px',
                objectFit: 'contain',
                borderRadius: 'var(--radius-sm, 4px)',
                cursor: 'pointer',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
              }}
              onClick={() => setIsExpanded(prev => !prev)}
            />
            <Text type="supporting" size="xsm" color="secondary">
              {isExpanded ? 'Click to collapse' : 'Click to expand image'}
            </Text>
          </VStack>
        ) : null}

        {isCode ? (
          <div
            style={{
              padding: '8px',
              fontFamily: 'monospace',
              fontSize: '12px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 'var(--radius-sm, 4px)',
              overflowX: 'auto',
              maxHeight: isExpanded ? '400px' : '120px',
            }}
          >
            <Text type="supporting" size="xsm" color="secondary">
              Code snippet preview ({attachment.name.split('.').pop()?.toUpperCase()})
            </Text>
          </div>
        ) : null}
      </VStack>
    </Card>
  );
}
