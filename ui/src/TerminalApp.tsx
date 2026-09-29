import {useState, type FormEvent} from 'react';

type Props = {
  botId: string;
  botName: string;
};

export function TerminalApp({botId: _botId, botName}: Props) {
  const [history, setHistory] = useState<string[]>([
    `[hermes@balabot-agent ~]$ # connected to ${botName} workspace`,
    `[hermes@balabot-agent ~]$ uname -a`,
    `Linux balabot-container 6.6.137 #1 SMP PREEMPT x86_64 GNU/Linux`,
    `[hermes@balabot-agent ~]$ ls -la /opt/data/profiles/`,
    `total 16`,
    `drwxr-xr-x 2 hermes hermes 4096 Sep 28 12:00 .`,
    `-rw-r--r-- 1 hermes hermes 1240 Sep 28 12:00 AGENTS.md`,
    `-rw-r--r-- 1 hermes hermes 2048 Sep 28 12:00 SOUL.md`,
    `-rw-r--r-- 1 hermes hermes  512 Sep 28 12:00 memory_store.db`,
  ]);
  const [command, setCommand] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    const cmd = command.trim();
    if (cmd === 'clear') {
      setHistory([]);
      setCommand('');
      return;
    }
    setHistory(prev => [
      ...prev,
      `[hermes@balabot-agent ~]$ ${cmd}`,
      `command executed: ${cmd} (exit status 0)`,
    ]);
    setCommand('');
  };

  return (
    <div
      className="rk-scroll"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0b0c0e',
        color: '#ececee',
        fontFamily: 'var(--font-family-code, monospace)',
        fontSize: '12px',
        padding: '12px 16px',
        overflowY: 'auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', gap: '4px', flex: 1}}>
        {history.map((line, idx) => (
          <div key={idx} style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>
            {line}
          </div>
        ))}
        <form onSubmit={handleSubmit} style={{display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center'}}>
          <span style={{color: '#4ecb71'}}>[hermes@balabot-agent ~]$</span>
          <input
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder="Type bash command…"
            autoFocus
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              outline: 'none',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          />
        </form>
      </div>
    </div>
  );
}
