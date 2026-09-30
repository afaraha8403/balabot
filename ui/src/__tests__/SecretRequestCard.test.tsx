import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretRequestCard } from '../SecretRequestCard';
import type { SecretCard, Bot } from '../api';
import * as api from '../api';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    postOrgSecret: vi.fn(),
  };
});

describe('SecretRequestCard - Secret Isolation & DOM Lifecycle', () => {
  const mockCard: SecretCard = {
    kind: 'secret_request',
    bot: 'security-bot',
    name: 'STRIPE_API_SECRET',
    description: 'Provide production Stripe secret for payment automation.',
    requestId: 'req_stripe_42',
    at: Date.now(),
  };

  const mockBots: Bot[] = [
    {
      id: 'security-bot',
      name: 'Security Bot',
      title: 'Security',
      icon: 'bot',
      color: '#fff',
      description: 'Sec bot',
      templateId: 't1',
      order: 1,
    },
    {
      id: 'billing-bot',
      name: 'Billing Bot',
      title: 'Billing',
      icon: 'bot',
      color: '#fff',
      description: 'Billing bot',
      templateId: 't2',
      order: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never stores the secret in React state or serialized DOM attributes while typing', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();

    const { container } = render(
      <SecretRequestCard card={mockCard} bots={mockBots} onResolve={onResolve} />,
    );

    const input = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('password');

    // The component must NOT bind `value` as a controlled prop
    expect(input.getAttribute('value')).toBeNull();

    const sensitiveSecret = 'sk_live_very_secret_key_1234567890';
    await user.type(input, sensitiveSecret);

    // The secret is present in the DOM input's live value
    expect(input.value).toBe(sensitiveSecret);

    // CRITICAL SECURITY INVARIANT:
    // The secret string must NEVER exist anywhere in the component's rendered HTML, text, or DOM attributes
    expect(container.innerHTML.includes(sensitiveSecret)).toBe(false);
    expect(input.getAttribute('value')).toBeNull();
  });

  it('reads the secret from the DOM ref on submit, passes it to postOrgSecret, and immediately wipes it from the DOM', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const sensitiveSecret = 'sk_live_production_secret_token_abc';

    vi.mocked(api.postOrgSecret).mockResolvedValueOnce({
      saved: true,
      name: 'STRIPE_API_SECRET',
      fingerprint: 'fp_stripe_999',
      granted_to: ['security-bot'],
    });

    const { container } = render(
      <SecretRequestCard card={mockCard} bots={mockBots} onResolve={onResolve} />,
    );

    const input = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    await user.type(input, sensitiveSecret);
    expect(input.value).toBe(sensitiveSecret);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Assert the secret was read directly and sent to postOrgSecret
    expect(api.postOrgSecret).toHaveBeenCalledTimes(1);
    expect(api.postOrgSecret).toHaveBeenCalledWith({
      name: 'STRIPE_API_SECRET',
      value: sensitiveSecret,
      share: ['security-bot'],
    });

    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('req_stripe_42', {
        state: 'saved',
        fingerprint: 'fp_stripe_999',
      });
    });

    // The secret must be completely wiped from the DOM input and never exist in rendered HTML
    expect(input.value).toBe('');
    expect(container.innerHTML.includes(sensitiveSecret)).toBe(false);
  });

  it('wipes the DOM input immediately when Cancel is clicked without calling API', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const sensitiveSecret = 'discarded_secret_xyz';

    render(
      <SecretRequestCard card={mockCard} bots={mockBots} onResolve={onResolve} />,
    );

    const input = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    await user.type(input, sensitiveSecret);
    expect(input.value).toBe(sensitiveSecret);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(api.postOrgSecret).not.toHaveBeenCalled();
    expect(onResolve).toHaveBeenCalledWith('req_stripe_42', { state: 'cancelled' });
    expect(input.value).toBe('');
  });

  it('wipes the secret from the DOM even when the save API rejects with an error', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const sensitiveSecret = 'failing_api_secret_777';

    vi.mocked(api.postOrgSecret).mockRejectedValueOnce(new Error('Network failure'));

    const { container } = render(
      <SecretRequestCard card={mockCard} bots={mockBots} onResolve={onResolve} />,
    );

    const input = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    await user.type(input, sensitiveSecret);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });

    // Wiped in finally block
    expect(input.value).toBe('');
    expect(container.innerHTML.includes(sensitiveSecret)).toBe(false);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('supports sharing with all bots or a specifically chosen bot', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();

    vi.mocked(api.postOrgSecret).mockResolvedValue({
      saved: true,
      name: 'STRIPE_API_SECRET',
      fingerprint: 'fp_multi',
    });

    const { rerender } = render(
      <SecretRequestCard card={mockCard} bots={mockBots} onResolve={onResolve} />,
    );

    // Share: All bots
    const shareSelect = screen.getByLabelText(/Share with/i);
    await user.selectOptions(shareSelect, 'all');

    const input = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    await user.type(input, 'secret_val_1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.postOrgSecret).toHaveBeenCalledWith({
      name: 'STRIPE_API_SECRET',
      value: 'secret_val_1',
      share: 'all',
    });

    // Share: Choose specific bot
    rerender(<SecretRequestCard card={{ ...mockCard, requestId: 'req_2' }} bots={mockBots} onResolve={onResolve} />);
    const shareSelect2 = screen.getByLabelText(/Share with/i);
    await user.selectOptions(shareSelect2, 'choose');

    const botPicker = await screen.findByLabelText(/Pick a bot/i);
    await user.selectOptions(botPicker, 'billing-bot');

    const input2 = screen.getByLabelText(/Value for STRIPE_API_SECRET/i) as HTMLInputElement;
    await user.type(input2, 'secret_val_2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.postOrgSecret).toHaveBeenCalledWith({
      name: 'STRIPE_API_SECRET',
      value: 'secret_val_2',
      share: ['billing-bot'],
    });
  });

  it('renders in resolved saved state without exposing password input', () => {
    const resolvedCard: SecretCard = {
      ...mockCard,
      status: { state: 'saved', fingerprint: 'fp_abc123' },
    };

    render(
      <SecretRequestCard card={resolvedCard} bots={mockBots} onResolve={vi.fn()} />,
    );

    expect(screen.queryByLabelText(/Value for STRIPE_API_SECRET/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('secret-saved-badge')).toBeInTheDocument();
    expect(screen.getByText(/Saved\. Fingerprint fp_abc123/i)).toBeInTheDocument();
  });
});
