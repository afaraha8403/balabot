import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, PhoneOff, Radio, Volume2 } from 'lucide-react';
import { readVoiceConfig } from './VoiceSettingsOverlay';

export type Phase = 'listening' | 'thinking' | 'speaking';

export type CallViewProps = {
  botId: string;
  botName: string;
  isStreaming?: boolean;
  streamText?: string;
  lastBotReply?: string;
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Polaris CallView component for interactive real-time voice conversations.
 * Includes listening, thinking, and speaking states, live transcription,
 * interrupt handling, speech synthesis, and keyboard shortcuts.
 */
export function CallView({
  botId,
  botName,
  isStreaming = false,
  streamText = '',
  lastBotReply = '',
  onSend,
  onClose,
}: CallViewProps) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);

  const phaseRef = useRef<Phase>('listening');
  const closingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const spokenMessageRef = useRef<string | null>(null);

  const setCallPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const hangUp = useCallback(() => {
    closingRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    onClose();
  }, [onClose]);

  const interrupt = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }
    setCaption('');
    setCallPhase('listening');
    startListening();
  }, [setCallPhase]);

  const speakText = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setCallPhase('listening');
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const voiceConfig = readVoiceConfig();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        // Prefer natural voices if available
        const preferred = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Samantha')));
        if (preferred) utterance.voice = preferred;
      }

      setCallPhase('speaking');
      setCaption(text);

      utterance.onend = () => {
        if (!closingRef.current) {
          setCaption('');
          setCallPhase('listening');
          startListening();
        }
      };

      utterance.onerror = () => {
        if (!closingRef.current) {
          setCaption('');
          setCallPhase('listening');
          startListening();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      setCallPhase('listening');
      startListening();
    }
  }, [setCallPhase]);

  const handleTranscript = useCallback(async (text: string) => {
    if (closingRef.current || !text.trim()) {
      startListening();
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    setHeard(text);
    setCallPhase('thinking');
    setError(null);

    try {
      await onSend(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send audio prompt');
      setCallPhase('listening');
      startListening();
    }
  }, [onSend, setCallPhase]);

  function startListening() {
    if (closingRef.current || phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
      return;
    }

    setCallPhase('listening');
    setHeard('');

    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          void handleTranscript(final);
        } else if (interim) {
          setHeard(interim);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setError(`Mic: ${event.error}`);
        }
      };

      recognition.onend = () => {
        if (!closingRef.current && phaseRef.current === 'listening') {
          // Restart listening after pause if still in listening mode
          setTimeout(() => {
            if (!closingRef.current && phaseRef.current === 'listening') {
              try {
                recognition.start();
              } catch {}
            }
          }, 400);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setSpeechSupported(false);
    }
  }

  // Keyboard controls: Escape hangs up, Space interrupts
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        hangUp();
      } else if (event.key === ' ' && phaseRef.current !== 'listening' && (event.target as HTMLElement)?.tagName !== 'INPUT') {
        event.preventDefault();
        interrupt();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hangUp, interrupt]);

  // Initial startup
  useEffect(() => {
    closingRef.current = false;
    spokenMessageRef.current = null;
    startListening();

    return () => {
      closingRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
  }, [botId]);

  // When bot finishes streaming a reply, speak it aloud
  useEffect(() => {
    if (!isStreaming && lastBotReply && lastBotReply !== spokenMessageRef.current && phaseRef.current === 'thinking') {
      spokenMessageRef.current = lastBotReply;
      speakText(lastBotReply);
    }
  }, [isStreaming, lastBotReply, speakText]);

  return (
    <div
      data-testid="call-view"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-[420px] rounded-3xl border border-border/80 bg-card p-6 text-center shadow-2xl space-y-5">
        {/* Header */}
        <div className="space-y-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center justify-center gap-1.5">
            <Radio size={14} className="text-primary animate-pulse" />
            <span>Voice Call</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{botName}</h2>
        </div>

        {/* Dynamic Orb / Status Waveform */}
        <div className="flex justify-center py-2">
          <div
            className={`relative flex h-24 w-24 items-center justify-center rounded-full transition-all duration-300 ${
              phase === 'listening'
                ? 'bg-primary/20 text-primary shadow-[0_0_30px_rgba(139,92,246,0.3)] animate-pulse'
                : phase === 'speaking'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.3)]'
                  : 'bg-amber-500/20 text-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.3)]'
            }`}
          >
            {phase === 'listening' && <Mic size={36} className="animate-bounce" />}
            {phase === 'speaking' && <Volume2 size={36} className="animate-pulse" />}
            {phase === 'thinking' && <Radio size={36} className="animate-spin" />}
          </div>
        </div>

        {/* Phase Label */}
        <div className="text-[15px] font-medium text-foreground/80">
          {phase === 'listening' ? (
            <span className="flex items-center justify-center gap-1.5">
              <span>Listening…</span>
            </span>
          ) : phase === 'speaking' ? (
            <span className="text-emerald-400 font-semibold">Speaking…</span>
          ) : (
            <span className="text-amber-400 font-semibold">Working…</span>
          )}
        </div>

        {/* Caption or Heard speech */}
        <div className="min-h-[3.6em] px-2 text-[14px] leading-relaxed text-muted-foreground flex items-center justify-center">
          {phase === 'listening' ? (
            heard ? (
              <span className="text-foreground font-medium italic">"{heard}"</span>
            ) : (
              <span>Say something. Silence sends it.</span>
            )
          ) : phase === 'speaking' ? (
            <span className="text-foreground/90 line-clamp-3 leading-snug">{caption}</span>
          ) : (
            <span>{streamText ? streamText.slice(-120) : 'Synthesizing response…'}</span>
          )}
        </div>

        {/* Fallback text input when mic is not accessible or for test runners */}
        {!speechSupported && (
          <div className="pt-2">
            <form
              onSubmit={e => {
                e.preventDefault();
                if (manualInput.trim()) {
                  const txt = manualInput.trim();
                  setManualInput('');
                  void handleTranscript(txt);
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="Type spoken sentence…"
                className="flex-1 rounded-full border border-border bg-background px-4 py-1.5 text-xs text-foreground outline-none focus:border-ring"
              />
              <button
                type="submit"
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Send
              </button>
            </form>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Action Controls */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={interrupt}
            className="rounded-full border border-border bg-background px-5 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors shadow-sm"
          >
            Interrupt
          </button>
          <button
            type="button"
            onClick={hangUp}
            className="flex items-center gap-1.5 rounded-full bg-destructive px-5 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm"
          >
            <PhoneOff size={15} />
            <span>Hang up</span>
          </button>
        </div>

        {/* Shortcut legend */}
        <p className="text-[11.5px] text-muted-foreground/75 select-none">
          Space interrupts · Esc hangs up
        </p>
      </div>
    </div>
  );
}
