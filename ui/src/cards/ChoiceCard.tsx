import { useState } from 'react';
import { X, Check } from 'lucide-react';

export type ChoiceOption = {
  id: string;
  letter: string;
  label: string;
};

export type ChoiceBlock = {
  kind: 'choice';
  question: string;
  subtitle?: string;
  options: ChoiceOption[];
  answerId?: string;
};

/**
 * Polaris ChoiceCard for multiple-choice onboarding or configuration prompts
 * with lettered badges (A, B, C, etc.).
 */
export function ChoiceCard({
  block,
  onChoose,
  onDismiss,
}: {
  block: ChoiceBlock;
  onChoose?: (optionId: string) => Promise<void> | void;
  onDismiss?: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(block.answerId);

  const effectiveAnswerId = selectedId || block.answerId;
  const dismissed = locallyDismissed || effectiveAnswerId === '_dismissed';

  async function choose(optionId: string) {
    if (pending || effectiveAnswerId) return;
    setPending(true);
    setError(null);
    try {
      if (onChoose) {
        await onChoose(optionId);
      }
      setSelectedId(optionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this choice');
    } finally {
      setPending(false);
    }
  }

  async function dismiss() {
    setPending(true);
    setError(null);
    try {
      if (onDismiss) {
        await onDismiss();
      }
      setLocallyDismissed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not dismiss');
    } finally {
      setPending(false);
    }
  }

  if (dismissed) return null;

  return (
    <div data-testid="choice-card" className="flex justify-start">
      <div className="relative w-[420px] max-w-full rounded-[20px] border border-border bg-card px-[18px] py-[14px] text-foreground shadow-sm">
        {!effectiveAnswerId ? (
          <button
            type="button"
            aria-label="Dismiss"
            disabled={pending}
            onClick={() => void dismiss()}
            className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="pe-8 text-[15.5px] font-medium text-foreground/90">
          {block.question}
        </div>
        {block.subtitle ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">{block.subtitle}</div>
        ) : null}
        <div className="mt-3 space-y-2.5">
          {block.options
            .filter(option => !effectiveAnswerId || option.id === effectiveAnswerId)
            .map(option => (
              <button
                key={option.id}
                type="button"
                disabled={Boolean(effectiveAnswerId) || pending}
                onClick={() => void choose(option.id)}
                className={`flex w-full items-start gap-3 rounded-xl px-3.5 py-3.5 text-start transition-colors disabled:opacity-80 ${
                  effectiveAnswerId === option.id
                    ? 'bg-accent border border-border font-medium'
                    : 'bg-muted hover:bg-accent border border-transparent'
                }`}
              >
                <span className="mt-0.5 grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[7px] bg-background text-[12.5px] font-medium text-foreground/75 shadow-xs">
                  {option.letter}
                </span>
                <span
                  className={`flex-1 text-[15px] leading-[1.35] ${
                    effectiveAnswerId === option.id ? 'text-foreground' : 'text-foreground/90'
                  }`}
                >
                  {option.label}
                </span>
                {effectiveAnswerId === option.id ? (
                  <Check size={16} className="mt-0.5 text-foreground shrink-0" />
                ) : null}
              </button>
            ))}
        </div>
        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      </div>
    </div>
  );
}
