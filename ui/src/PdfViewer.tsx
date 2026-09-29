import { useEffect, useState } from 'react';

export function PdfViewer({
  bytes,
  url: directUrl,
  title,
}: {
  bytes?: Uint8Array;
  url?: string;
  title: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (directUrl) return;
    if (!bytes) return;
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [bytes, directUrl]);

  const targetUrl = directUrl || blobUrl;
  if (!targetUrl) return null;

  return (
    <iframe
      title={title}
      src={targetUrl}
      className="h-full w-full border-0"
      style={{ minHeight: '500px', width: '100%', height: '100%', border: 0 }}
    />
  );
}
