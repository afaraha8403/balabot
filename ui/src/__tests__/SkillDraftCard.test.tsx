import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillDraftCard, type SkillDraftBlock } from '../cards/SkillDraftCard';

describe('SkillDraftCard', () => {
  const mockBlock: SkillDraftBlock = {
    kind: 'skill_draft',
    skillId: 'test-skill-001',
    name: 'Email Automation',
    goal: 'Automate email campaign generation and tracking',
    playbook: {
      whenToUse: 'When user needs to generate and schedule marketing emails',
      inputs: ['Campaign name', 'Target audience', 'Email content'],
      steps: [
        'Parse campaign requirements',
        'Generate personalized email content',
        'Schedule delivery',
        'Track open rates',
      ],
      howToCheck: 'Verify email sent successfully and tracking enabled',
      whatToReturn: 'Campaign ID and tracking URL',
      approvalBoundaries: 'Requires approval before sending to >100 recipients',
      failureHandling: 'Retry failed sends, notify user of permanent failures',
    },
    status: 'draft',
  };

  it('renders the skill draft card with testid', () => {
    render(<SkillDraftCard block={mockBlock} />);
    const card = screen.getByTestId('skill-draft-card');
    expect(card).toBeInTheDocument();
  });

  it('displays the goal', () => {
    render(<SkillDraftCard block={mockBlock} />);
    expect(screen.getByText('Automate email campaign generation and tracking')).toBeInTheDocument();
  });

  it('displays the skill name in the input field', () => {
    render(<SkillDraftCard block={mockBlock} />);
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('Email Automation');
  });

  it('displays playbook fields with correct values', () => {
    render(<SkillDraftCard block={mockBlock} />);

    const whenToUseField = screen.getByLabelText('When to use') as HTMLTextAreaElement;
    expect(whenToUseField.value).toBe('When user needs to generate and schedule marketing emails');

    const inputsField = screen.getByLabelText('Inputs') as HTMLTextAreaElement;
    expect(inputsField.value).toContain('Campaign name');
    expect(inputsField.value).toContain('Target audience');

    const stepsField = screen.getByLabelText('Steps') as HTMLTextAreaElement;
    expect(stepsField.value).toContain('Parse campaign requirements');
    expect(stepsField.value).toContain('Track open rates');
  });

  it('renders Save, Test, and Add to routine buttons', () => {
    render(<SkillDraftCard block={mockBlock} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routine' })).toBeInTheDocument();
  });

  it('shows "Saved" button label when status is saved', () => {
    const savedBlock: SkillDraftBlock = { ...mockBlock, status: 'saved' };
    render(<SkillDraftCard block={savedBlock} />);
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
  });
});
