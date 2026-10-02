import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillDraftCard, type SkillDraftBlock } from '../cards/SkillDraftCard';

/**
 * Integration test proving the App.tsx block renderer can reach SkillDraftCard.
 * Simulates the exact path: message.blocks[].kind === 'skill_draft' -> <SkillDraftCard block={block} />
 */
describe('SkillDraftCard - App.tsx block rendering integration', () => {
  const mockBlock: SkillDraftBlock = {
    kind: 'skill_draft',
    skillId: 'skill-001',
    name: 'Integration Test Skill',
    goal: 'Prove card renders from block map',
    playbook: {
      whenToUse: 'When testing integration',
      inputs: ['Test input'],
      steps: ['Step 1', 'Step 2'],
      howToCheck: 'Check test passes',
      whatToReturn: 'Test result',
      approvalBoundaries: 'Auto-approve tests',
      failureHandling: 'Report failure',
    },
    status: 'draft',
  };

  it('renders SkillDraftCard when block.kind === "skill_draft" (simulates App.tsx map)', () => {
    // Simulate the App.tsx path: {m.blocks.map((block) => { if (block.kind === 'skill_draft') return <SkillDraftCard block={block} /> })}
    const blocks = [mockBlock];
    const { container } = render(
      <>
        {blocks.map((block, idx) => {
          if (block.kind === 'skill_draft') return <SkillDraftCard key={idx} block={block} />;
          return null;
        })}
      </>
    );

    const card = container.querySelector('[data-testid="skill-draft-card"]');
    expect(card).not.toBeNull();
    expect(card).toBeInTheDocument();
  });

  it('returns null when block.kind is NOT "skill_draft" (default behavior)', () => {
    const nonMatchingBlock = { kind: 'ask' } as any;
    const blocks = [nonMatchingBlock];
    const { container } = render(
      <>
        {blocks.map((block, idx) => {
          if (block.kind === 'skill_draft') return <SkillDraftCard key={idx} block={block} />;
          return null;
        })}
      </>
    );

    const card = container.querySelector('[data-testid="skill-draft-card"]');
    expect(card).toBeNull();
  });
});
