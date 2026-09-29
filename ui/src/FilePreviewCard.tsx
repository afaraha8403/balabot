import { ArtifactFileCard } from './ArtifactFileCard';
import type { Attachment } from './api';

export type FilePreviewCardProps = {
  attachment: Attachment;
  onDownload?: (att: Attachment) => void;
};

/**
 * FilePreviewCard: re-exports Polaris ArtifactFileCard to give all attachments
 * modal previews for PDF, sandboxed HTML, images, and markdown documents.
 */
export function FilePreviewCard({ attachment, onDownload }: FilePreviewCardProps) {
  return (
    <ArtifactFileCard
      attachment={attachment}
      name={attachment.name}
      mimeType={attachment.mime_type}
      size={attachment.size}
      url={attachment.url || attachment.path}
      onDownload={onDownload ? () => onDownload(attachment) : undefined}
    />
  );
}

export { ArtifactFileCard };
