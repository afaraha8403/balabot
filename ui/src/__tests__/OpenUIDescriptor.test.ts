import { describe, it, expect } from 'vitest';
import {
  parseOpenUIRequestDescriptor,
  isOpenUISameOrUpdatedRequest,
  findSupersededOpenUIMessageIndices,
} from '../openui/descriptor';

describe('OpenUI Request Descriptor & Superseding Resolution', () => {
  it('correctly parses HireAgentCard descriptors from OpenUI code', () => {
    const code = `root = HireAgentCard("Blog Writer", "quill", "Researches topics and writes posts.", "SEO, Writing")`;
    const desc = parseOpenUIRequestDescriptor(code);
    expect(desc).not.toBeNull();
    expect(desc?.type).toBe('HireAgentCard');
    expect(desc?.role).toBe('Blog Writer');
    expect(desc?.name).toBe('quill');
  });

  it('correctly parses ConfirmButtons descriptors', () => {
    const code = `root = ConfirmButtons("Deploy Agent", "Cancel")`;
    const desc = parseOpenUIRequestDescriptor(code);
    expect(desc).not.toBeNull();
    expect(desc?.type).toBe('ConfirmButtons');
    expect(desc?.confirmLabel).toBe('Deploy Agent');
    expect(desc?.cancelLabel).toBe('Cancel');
  });

  it('identifies repeated hire requests for the same bot as the same request', () => {
    const desc1 = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer", "quill", "Initial proposal.")`
    )!;
    const desc2 = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer", "quill", "Re-emitted proposal with confirmed scope.")`
    )!;

    expect(isOpenUISameOrUpdatedRequest(desc1, desc2)).toBe(true);
  });

  it('identifies updated hire requests with role specialization updates', () => {
    const desc1 = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer", "quill", "Writes blogs.")`
    )!;
    const desc2 = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer & SEO", "quill", "Writes blogs with SEO skills.")`
    )!;

    expect(isOpenUISameOrUpdatedRequest(desc1, desc2)).toBe(true);
  });

  it('does NOT mark distinct unrelated hire requests as the same request', () => {
    const descQuill = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer", "quill", "Researches topics and writes posts.")`
    )!;
    const descSeo = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("SEO Specialist", "seo-expert", "Keyword research and organic ranking.")`
    )!;

    expect(isOpenUISameOrUpdatedRequest(descQuill, descSeo)).toBe(false);
  });

  it('does NOT mark different component types as the same request', () => {
    const descHire = parseOpenUIRequestDescriptor(
      `root = HireAgentCard("Blog Writer", "quill", "Writes blogs.")`
    )!;
    const descConfirm = parseOpenUIRequestDescriptor(
      `root = ConfirmButtons("Approve", "Cancel")`
    )!;

    expect(isOpenUISameOrUpdatedRequest(descHire, descConfirm)).toBe(false);
  });

  it('finds superseded message indices across a conversation transcript', () => {
    const messages = [
      {
        content: `I recommend hiring Quill.\n\`\`\`openui-lang\nroot = HireAgentCard("Blog Writer", "quill", "Researches and writes blogs.", "Writing")\n\`\`\``,
      },
      {
        content: `They need skills from skills.sh`,
      },
      {
        content: `Understood, let's look at skills.sh`,
      },
      {
        content: `Okay, never mind, let's just hire`,
      },
      {
        content: `Here is the confirmed proposal card:\n\`\`\`openui-lang\nroot = HireAgentCard("Blog Writer", "quill", "Researches and writes blogs.", "Writing, Research")\n\`\`\``,
      },
    ];

    const superseded = findSupersededOpenUIMessageIndices(messages);
    expect(superseded.has(0)).toBe(true);  // Turn 0 is superseded by Turn 4
    expect(superseded.has(4)).toBe(false); // Turn 4 is the latest and active
  });

  it('does not supersede panels when requests are for completely different agents', () => {
    const messages = [
      {
        content: `\`\`\`openui-lang\nroot = HireAgentCard("Blog Writer", "quill", "Writes blogs.")\n\`\`\``,
      },
      {
        content: `\`\`\`openui-lang\nroot = HireAgentCard("Security Auditor", "sentinel", "Audits code.")\n\`\`\``,
      },
    ];

    const superseded = findSupersededOpenUIMessageIndices(messages);
    expect(superseded.has(0)).toBe(false);
    expect(superseded.has(1)).toBe(false);
  });
});
