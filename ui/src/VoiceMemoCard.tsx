import {useRef, useState} from 'react';
import type {VoiceMemoData} from './api';

type Props = {
  memo: VoiceMemoData;
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Polaris VoiceMemoCard:
 * Renders an in-conversation voice memo from a Bot with Play/Pause audio
 * playback and an expandable transcript, styled with Polaris card tokens
 * and a circular play button.
 */
export function VoiceMemoCard({memo}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current && memo.audioUrl) {
      audioRef.current = new Audio(memo.audioUrl);
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play();
        setIsPlaying(true);
      }
    } else {
      // Toggle play state indicator if no actual audioUrl is attached
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div
      data-testid="voice-memo-card"
      style={{
        width: '100%',
        maxWidth: '420px',
        borderRadius: '16px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        color: 'var(--card-foreground)',
        padding: '12px 14px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        margin: '6px 0',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
          {/* Circular play button matching Polaris style */}
          <button
            type="button"
            aria-label={isPlaying ? 'Pause voice memo' : 'Play voice memo'}
            onClick={togglePlay}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '9999px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--muted)',
              color: 'var(--foreground)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
              transition: 'background-color 120ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'var(--accent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'var(--muted)';
            }}
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{marginLeft: '2px'}}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
              Voice memo
            </span>
          </div>
        </div>

        <span style={{fontSize: '12px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-family-code, monospace)'}}>
          {formatDuration(memo.durationSec)}
        </span>
      </div>

      {/* Transcript collapsible disclosure */}
      <div>
        <button
          type="button"
          onClick={() => setShowTranscript(prev => !prev)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: 'transparent',
            border: 'none',
            color: 'var(--muted-foreground)',
            fontSize: '11.5px',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '2px 0',
            fontFamily: 'inherit',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: showTranscript ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>Transcript</span>
        </button>

        {showTranscript ? (
          <div
            style={{
              backgroundColor: 'var(--muted)',
              borderRadius: '10px',
              padding: '10px 12px',
              fontSize: '12.5px',
              color: 'var(--foreground)',
              lineHeight: 1.5,
              marginTop: '6px',
            }}
          >
            {memo.transcript || 'No transcript available.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
