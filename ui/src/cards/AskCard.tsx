import { useState } from 'react';
import { ChatMarkdown } from '../ChatMarkdown';

export type AskAction = {
  id: string;
  label: string;
  outcome?: 'created' | 'cancelled';
};

export type AskBlock = {
  kind: 'ask';
  text: string;
  status?: 'pending' | 'answered';
  answer?: string;
  actions?: AskAction[];
  purpose?: 'password' | 'api_key' | 'code' | 'general';
  detail?: string;
  credential?: {
    origin: string;
    auth: {
      type: 'login' | 'secret';
    };
  };
};

function formatAnsweredState(
  answer: string | undefined,
  approval: boolean,
  secret: boolean,
  outcome?: 'created' | 'cancelled',
  actions?: AskAction[],
): string {
  if (secret) return 'Saved';
  if (!answer) return 'Answered';
  if (!approval) {
    const found = actions?.find(a => a.id === answer);
    return `Answered: ${found?.label ?? answer}`;
  }
  if (outcome === 'created') return 'Created';
  if (outcome === 'cancelled') return 'Cancelled';
  if (answer === 'allow') return 'Allowed once';
  if (answer === 'always') return 'Always allowed';
  if (answer === 'deny') return 'Denied';
  return `Answered: ${answer}`;
}

function approvalActionLabel(
  id: string,
  fallback: string,
  outcome?: 'created' | 'cancelled',
): string {
  if (outcome === 'created') return 'Create space';
  if (outcome === 'cancelled') return 'Cancel';
  if (id === 'allow') return 'Allow once';
  if (id === 'always') return 'Always allow this tool';
  if (id === 'deny') return 'Deny';
  return fallback;
}

function secretFieldLabel(purpose: AskBlock['purpose']): string {
  if (purpose === 'password') return 'Password';
  if (purpose === 'api_key') return 'API key';
  return 'Code';
}

/**
 * Polaris AskCard for interactive agent questions, permission gates,
 * and secret inputs in the transcript.
 */
export function AskCard({
  block,
  canAnswer = true,
  onAnswer,
}: {
  block: AskBlock;
  canAnswer?: boolean;
  onAnswer?: (text: string, username?: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [username, setUsername] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitting = pendingAction !== null;
  const approvalActions = block.actions?.some(a => a.id === 'allow' || a.id === 'deny')
    ? block.actions
    : undefined;
  const askActions = block.actions;
  const secretInput = block.purpose === 'password' || block.purpose === 'api_key' || block.purpose === 'code';
  const loginInput = secretInput && block.credential?.auth.type === 'login';
  const secretLabel = loginInput ? 'Password' : secretFieldLabel(block.purpose);

  async function submitAnswer(value: string) {
    if (submitting) return;
    if (secretInput ? value.length === 0 : !value.trim()) return;
    const submitUsername = loginInput ? username.trim() : undefined;
    if (loginInput && !submitUsername) return;
    const submitValue = secretInput ? value : value.trim();
    setPendingAction(secretInput ? 'submit' : submitValue);
    setError(null);
    if (secretInput) {
      setAnswer('');
      setUsername('');
    }
    try {
      if (onAnswer) {
        await onAnswer(submitValue, submitUsername);
      }
    } catch (err) {
      setError(
        !secretInput && err instanceof Error ? err.message : 'Could not submit this answer',
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div
      data-testid={secretInput ? 'secret-ask-card' : 'ask-card'}
      className="max-w-[74%] rounded-2xl border border-border bg-card px-5 py-4 text-foreground shadow-sm"
    >
      <div className="text-[15.5px] leading-[1.5] text-foreground">
        <ChatMarkdown>{block.text}</ChatMarkdown>
      </div>
      {secretInput && block.credential ? (
        <div className="mt-2 break-all text-[13px] text-muted-foreground">
          {block.credential.origin}
        </div>
      ) : null}
      {block.detail && !secretInput ? (
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] text-muted-foreground">
          {block.detail}
        </pre>
      ) : null}
      {block.status === 'answered' ? (
        <div className="mt-3.5 text-[13.5px] font-medium text-green-500">
          {formatAnsweredState(
            block.answer,
            Boolean(approvalActions),
            secretInput,
            approvalActions?.find(action => action.id === block.answer)?.outcome,
            askActions,
          )}
        </div>
      ) : !canAnswer ? (
        <div className="mt-3.5 text-[13.5px] font-medium text-muted-foreground">
          No longer active
        </div>
      ) : askActions?.length ? (
        <div className="mt-3.5 space-y-1.5">
          {askActions.map(action => (
            <button
              key={action.id}
              type="button"
              className={`h-auto w-full justify-start whitespace-normal rounded-xl border px-3.5 py-3 text-start font-normal transition-colors disabled:opacity-50 ${
                approvalActions && action.id === 'allow'
                  ? 'border-primary bg-primary text-primary-foreground hover:opacity-90'
                  : 'border-border bg-transparent text-foreground hover:bg-accent'
              }`}
              disabled={submitting}
              onClick={() => void submitAnswer(action.id)}
            >
              {pendingAction === action.id ? (
                'Sending…'
              ) : approvalActions ? (
                approvalActionLabel(action.id, action.label, action.outcome)
              ) : (
                action.label
              )}
            </button>
          ))}
        </div>
      ) : secretInput ? (
        <form
          className="mt-3.5 flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault();
            void submitAnswer(answer);
          }}
        >
          {loginInput ? (
            <input
              aria-label="Username"
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
              value={username}
              onChange={event => setUsername(event.target.value)}
              placeholder="Username"
              className="polaris-input"
            />
          ) : null}
          <input
            aria-label={secretLabel}
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            placeholder={secretLabel}
            className="polaris-input"
          />
          <button
            type="submit"
            className="polaris-btn polaris-btn-primary self-start"
            disabled={answer.length === 0 || (loginInput && !username.trim()) || submitting}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </form>
      ) : editing ? (
        <form
          className="mt-3.5 flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault();
            void submitAnswer(answer);
          }}
        >
          <input
            aria-label="Answer"
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            placeholder="Type your answer"
            className="polaris-input"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="polaris-btn polaris-btn-primary"
              disabled={!answer.trim() || submitting}
            >
              {submitting ? 'Sending…' : 'Send answer'}
            </button>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline"
              disabled={submitting}
              onClick={() => {
                setAnswer('');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            className="polaris-btn polaris-btn-primary"
            disabled={submitting}
            onClick={() => void submitAnswer('approved')}
          >
            {submitting ? 'Sending…' : 'Send it'}
          </button>
          <button
            type="button"
            className="polaris-btn polaris-btn-outline"
            disabled={submitting}
            onClick={() => setEditing(true)}
          >
            Edit first
          </button>
        </div>
      )}
      {error ? <p className="mt-3 text-[13px] text-red-500">{error}</p> : null}
    </div>
  );
}
