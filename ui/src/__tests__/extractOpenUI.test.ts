import { describe, it, expect } from 'vitest';
import { extractOpenUI } from '../openui/OpenUIRenderer';

describe('extractOpenUI', () => {
  describe('regression: untagged fence with root= (reported bug)', () => {
    it('should recognize untagged fence with root= as OpenUI', () => {
      const content = `Got it — here's what I'd file. Confirm and it goes straight to your dashboard for one-click approval.

\`\`\`
root = HireAgentCard("Marketing & SEO Expert", "marlow", "Own SEO strategy and content growth: ...", "SEO audits, keyword research, ...")
\`\`\`

Name's a placeholder if you hate it — say the word and I'll refile.`;

      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(true);
      expect(result.openuiCode).toContain('root = HireAgentCard(');
      expect(result.before).toContain("here's what I'd file");
      expect(result.after).toContain("Name's a placeholder");
    });
  });

  describe('positive cases: existing working patterns', () => {
    it('should recognize tagged openui-lang fence', () => {
      const content = `Check this out:\n\n\`\`\`openui-lang\nroot = Button("Click me")\n\`\`\`\n\nLooks good?`;
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(true);
      expect(result.openuiCode).toBe('root = Button("Click me")');
      expect(result.before).toBe('Check this out:');
      expect(result.after).toBe('Looks good?');
    });

    it('should recognize tagged openui fence', () => {
      const content = `\`\`\`openui\nroot = Card("Test")\n\`\`\``;
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(true);
      expect(result.openuiCode).toBe('root = Card("Test")');
    });

    it('should recognize bare message starting with root=', () => {
      const content = 'root = List([Item("one"), Item("two")])';
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(true);
      expect(result.openuiCode).toBe(content);
      expect(result.before).toBe('');
      expect(result.after).toBe('');
    });

    it('should recognize bare message starting with root = (with space)', () => {
      const content = 'root = Button("Test")';
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(true);
      expect(result.openuiCode).toBe(content);
    });
  });

  describe('negative cases: must not match', () => {
    it('should not match plain prose', () => {
      const content = 'This is just some regular text with no code.';
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(false);
      expect(result.before).toBe(content);
      expect(result.openuiCode).toBe('');
    });

    it('should not match non-OpenUI code fence (bash)', () => {
      const content = `Run this:\n\n\`\`\`bash\necho "hello"\n\`\`\``;
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(false);
    });

    it('should not match untagged fence without root=', () => {
      const content = `Some text\n\n\`\`\`\nconst x = 5;\nconsole.log(x);\n\`\`\`\n\nMore text`;
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(false);
    });

    it('should not match untagged fence with root in middle', () => {
      const content = `\`\`\`\nconst data = {};\nroot = Card("test");\n\`\`\``;
      const result = extractOpenUI(content);
      
      expect(result.hasOpenUI).toBe(false);
    });
  });
});
