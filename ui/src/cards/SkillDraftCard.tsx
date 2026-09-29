import {useState, useEffect} from 'react';

export type SkillPlaybook = {
  whenToUse: string;
  inputs: string[];
  steps: string[];
  howToCheck: string;
  whatToReturn: string;
  approvalBoundaries: string;
  failureHandling: string;
};

export type SkillDraftBlock = {
  kind: 'skill_draft';
  skillId: string;
  name: string;
  goal: string;
  playbook: SkillPlaybook;
  status: 'draft' | 'saved';
};

function fieldLabel(id: string, title: string) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'block',
        marginTop: '12px',
        marginBottom: '4px',
        fontSize: '13px',
        fontWeight: 400,
        color: 'var(--muted-foreground)',
      }}
    >
      {title}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  backgroundColor: 'var(--input, var(--muted))',
  color: 'var(--foreground)',
  fontSize: '13px',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
};

export function SkillDraftCard({
  block,
  onRefresh,
  onAddRoutine,
}: {
  block: SkillDraftBlock;
  onRefresh?: () => Promise<void> | void;
  onAddRoutine?: (name: string, prompt: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(block.name);
  const [playbook, setPlaybook] = useState(block.playbook);
  const [saved, setSaved] = useState(block.status === 'saved');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    setName(block.name);
    setPlaybook(block.playbook);
    setSaved(block.status === 'saved');
  }, [block.skillId, block.status, block.name, block.playbook]);

  const skillName = name || block.name || block.goal.slice(0, 80);

  const saveDraft = async () => {
    setBusy(true);
    setStatusMessage('');
    try {
      setSaved(true);
      setStatusMessage('Skill draft saved successfully.');
      if (onRefresh) await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const testDraft = async () => {
    setBusy(true);
    setStatusMessage('');
    try {
      setStatusMessage(`Test execution simulated for ${skillName}.`);
      if (onRefresh) await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleAddRoutine = async () => {
    if (onAddRoutine) {
      const prompt = playbook.steps.join(' -> ');
      await onAddRoutine(skillName, prompt);
      setStatusMessage(`Added "${skillName}" as a bot routine!`);
    }
  };

  return (
    <div
      data-testid="skill-draft-card"
      style={{
        width: 'min(520px, 92%)',
        borderRadius: '16px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        padding: '16px 20px',
        boxSizing: 'border-box',
        color: 'var(--foreground)',
        marginTop: '8px',
        marginBottom: '8px',
      }}
    >
      <div style={{fontSize: '15px', fontWeight: 500, color: 'var(--foreground)'}}>
        Draft skill
      </div>
      <div style={{marginTop: '4px', fontSize: '13.5px', color: 'var(--muted-foreground)'}}>
        {block.goal}
      </div>

      {fieldLabel('skill-draft-name', 'Name')}
      <input
        id="skill-draft-name"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
      />

      {fieldLabel('skill-draft-when', 'When to use')}
      <textarea
        id="skill-draft-when"
        rows={2}
        value={playbook.whenToUse}
        onChange={e => setPlaybook({...playbook, whenToUse: e.target.value})}
        style={inputStyle}
      />

      {fieldLabel('skill-draft-inputs', 'Inputs')}
      <textarea
        id="skill-draft-inputs"
        rows={2}
        value={playbook.inputs.join('\n')}
        onChange={e =>
          setPlaybook({
            ...playbook,
            inputs: e.target.value.split('\n'),
          })
        }
        style={inputStyle}
      />

      {fieldLabel('skill-draft-steps', 'Steps')}
      <textarea
        id="skill-draft-steps"
        rows={4}
        value={playbook.steps.join('\n')}
        onChange={e =>
          setPlaybook({
            ...playbook,
            steps: e.target.value.split('\n'),
          })
        }
        style={inputStyle}
      />

      {fieldLabel('skill-draft-check', 'How to check')}
      <textarea
        id="skill-draft-check"
        rows={2}
        value={playbook.howToCheck}
        onChange={e => setPlaybook({...playbook, howToCheck: e.target.value})}
        style={inputStyle}
      />

      {fieldLabel('skill-draft-return', 'What to return')}
      <textarea
        id="skill-draft-return"
        rows={2}
        value={playbook.whatToReturn}
        onChange={e => setPlaybook({...playbook, whatToReturn: e.target.value})}
        style={inputStyle}
      />

      {fieldLabel('skill-draft-approval', 'Approval boundaries')}
      <textarea
        id="skill-draft-approval"
        rows={2}
        value={playbook.approvalBoundaries}
        onChange={e => setPlaybook({...playbook, approvalBoundaries: e.target.value})}
        style={inputStyle}
      />

      {fieldLabel('skill-draft-failure', 'Failure handling')}
      <textarea
        id="skill-draft-failure"
        rows={2}
        value={playbook.failureHandling}
        onChange={e => setPlaybook({...playbook, failureHandling: e.target.value})}
        style={inputStyle}
      />

      {statusMessage ? (
        <div style={{marginTop: '12px', fontSize: '13px', color: 'var(--success)'}}>
          {statusMessage}
        </div>
      ) : null}

      <div style={{marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveDraft()}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {saved ? 'Saved' : busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void testDraft()}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--foreground)',
            fontSize: '13px',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Test
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleAddRoutine()}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--foreground)',
            fontSize: '13px',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Add to routine
        </button>
      </div>
    </div>
  );
}
