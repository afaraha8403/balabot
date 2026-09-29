import {useState} from 'react';

type FileItem = {
  name: string;
  size: string;
  type: string;
  isDir?: boolean;
};

type Props = {
  botId: string;
  botName?: string;
};

export function FilesApp({botId}: Props) {
  const [currentPath, setCurrentPath] = useState(`/opt/data/profiles/${botId}`);
  const [files] = useState<FileItem[]>([
    {name: 'AGENTS.md', size: '1.2 KB', type: 'Markdown'},
    {name: 'SOUL.md', size: '2.0 KB', type: 'Markdown'},
    {name: 'memory_store.db', size: '512 B', type: 'SQLite Database'},
    {name: 'rules', size: 'Directory', type: 'Folder', isDir: true},
    {name: 'logs', size: 'Directory', type: 'Folder', isDir: true},
  ]);

  return (
    <div
      className="rk-scroll"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--card)',
        color: 'var(--foreground)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Breadcrumb bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          fontSize: '12.5px',
          color: 'var(--muted-foreground)',
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{color: 'var(--foreground)', fontWeight: 500}}>{currentPath}</span>
      </div>

      {/* Files list */}
      <div style={{padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1}}>
        {files.map(file => (
          <div
            key={file.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            onClick={() => {
              if (file.isDir) {
                setCurrentPath(prev => `${prev}/${file.name}`);
              }
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              {file.isDir ? (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth={2}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth={2}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
              <span style={{color: 'var(--foreground)'}}>{file.name}</span>
            </div>
            <span style={{fontSize: '12px', color: 'var(--muted-foreground)'}}>
              {file.size}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
