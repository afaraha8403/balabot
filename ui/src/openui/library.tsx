import React, { useState } from 'react';
import { defineComponent, createLibrary, useTriggerAction } from '@openuidev/react-lang';
import { z } from 'zod';
import { useOpenUIContext } from './OpenUIContext';
import './openui.css';

/**
 * HireAgentCard: The flagship Generative UI component solving the owner's complaint.
 * Instead of silently filing a proposal in the background, the agent renders this card
 * in chat to collect confirmation and parameters before spooling the new bot profile.
 */
export const HireAgentCard = defineComponent({
  name: 'HireAgentCard',
  description: 'Interactive confirmation card for creating and hiring a new agent into the bot fleet.',
  props: z.object({
    role: z.string().describe('The designated role or title of the agent to hire'),
    name: z.string().describe('Suggested system name/identifier for the agent'),
    description: z.string().describe('Summary of agent capabilities and responsibilities'),
    skills: z.string().optional().describe('Key skills or domains covered'),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const { disabled, superseded } = useOpenUIContext();
    const [name, setName] = useState(props.name);
    const [role, setRole] = useState(props.role);
    const [desc, setDesc] = useState(props.description);
    const [status, setStatus] = useState<'pending' | 'approved' | 'dismissed'>('pending');
    const [submitting, setSubmitting] = useState(false);

    const isEffectivelyDisabled = Boolean(disabled || superseded || status !== 'pending' || submitting);

    const handleApprove = () => {
      if (isEffectivelyDisabled) return;
      setSubmitting(true);
      setStatus('approved');
      triggerAction(`Approve & Hire: ${role} (${name})`, 'HireAgentForm', {
        type: 'approve_hire',
        params: { name, role, description: desc },
      });
    };

    const handleDismiss = () => {
      setStatus('dismissed');
      triggerAction(`Dismissed proposal for ${role}`, 'HireAgentForm', {
        type: 'dismiss_hire',
        params: { name, role },
      });
    };

    return (
      <div className="openui-card" data-testid="openui-hire-agent-card">
        <div className="openui-card-header">
          <div className="openui-card-badge">Agent Proposal · Consent Gate</div>
          <h3 className="openui-card-title">Hire New Agent: {role}</h3>
          <p className="openui-card-subtitle">
            Review and confirm the proposed configuration below before anything is spooled.
          </p>
        </div>

        <div className="openui-form-group">
          <div className="openui-form-field">
            <label className="openui-form-label">System Identifier (Bot Name)</label>
            <input
              type="text"
              className="openui-form-input"
              value={name}
              disabled={isEffectivelyDisabled}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. marketing-seo-expert"
            />
          </div>

          <div className="openui-form-field">
            <label className="openui-form-label">Role Title</label>
            <input
              type="text"
              className="openui-form-input"
              value={role}
              disabled={isEffectivelyDisabled}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Marketing & SEO Expert"
            />
          </div>

          <div className="openui-form-field">
            <label className="openui-form-label">Role Mission & Responsibilities</label>
            <textarea
              className="openui-form-textarea"
              value={desc}
              disabled={isEffectivelyDisabled}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
            />
          </div>

          {props.skills && (
            <div className="openui-form-field">
              <label className="openui-form-label">Domain Skills</label>
              <input
                type="text"
                className="openui-form-input"
                value={props.skills}
                readOnly
                disabled
              />
            </div>
          )}
        </div>

        <div className="openui-actions">
          {status === 'pending' && (
            <>
              <button
                type="button"
                className="openui-btn openui-btn-primary"
                onClick={handleApprove}
                disabled={isEffectivelyDisabled}
              >
                Approve & Hire Agent
              </button>
              <button
                type="button"
                className="openui-btn openui-btn-secondary"
                onClick={handleDismiss}
                disabled={isEffectivelyDisabled}
              >
                Dismiss
              </button>
              {superseded && (
                <span className="openui-superseded-banner" data-testid="openui-superseded-banner">
                  (Superseded by updated request)
                </span>
              )}
            </>
          )}

          {status === 'approved' && (
            <div className="openui-status-badge openui-status-success">
              ✓ Proposal Approved — Spooling Agent Profile
            </div>
          )}

          {status === 'dismissed' && (
            <div className="openui-status-badge openui-status-muted">
              ✕ Proposal Dismissed
            </div>
          )}
        </div>
      </div>
    );
  },
});

export const Card = defineComponent({
  name: 'Card',
  description: 'General container card for structured content',
  props: z.object({
    title: z.string().describe('Card title'),
    content: z.string().optional().describe('Card text or description'),
  }),
  component: ({ props }) => (
    <div className="openui-card">
      <h4 className="openui-card-title">{props.title}</h4>
      {props.content && <p className="openui-card-subtitle">{props.content}</p>}
    </div>
  ),
});

export const CardHeader = defineComponent({
  name: 'CardHeader',
  description: 'Card header element with title and subtitle',
  props: z.object({
    title: z.string().describe('Header title'),
    subtitle: z.string().optional().describe('Header subtitle'),
  }),
  component: ({ props }) => (
    <div className="openui-card-header">
      <h4 className="openui-card-title">{props.title}</h4>
      {props.subtitle && <p className="openui-card-subtitle">{props.subtitle}</p>}
    </div>
  ),
});

export const FormField = defineComponent({
  name: 'FormField',
  description: 'A labeled input field for data collection',
  props: z.object({
    label: z.string().describe('Field label'),
    value: z.string().describe('Default value'),
    placeholder: z.string().optional().describe('Placeholder hint text'),
  }),
  component: ({ props }) => (
    <div className="openui-form-field">
      <label className="openui-form-label">{props.label}</label>
      <input
        type="text"
        className="openui-form-input"
        defaultValue={props.value}
        placeholder={props.placeholder}
      />
    </div>
  ),
});

export const ConfirmButtons = defineComponent({
  name: 'ConfirmButtons',
  description: 'A pair of confirm and cancel action buttons',
  props: z.object({
    confirmLabel: z.string().describe('Label for the primary confirm button'),
    cancelLabel: z.string().describe('Label for the secondary cancel button'),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const { disabled, superseded } = useOpenUIContext();
    const isEffectivelyDisabled = Boolean(disabled || superseded);

    return (
      <div className="openui-actions">
        <button
          type="button"
          className="openui-btn openui-btn-primary"
          onClick={() => triggerAction(props.confirmLabel)}
          disabled={isEffectivelyDisabled}
        >
          {props.confirmLabel}
        </button>
        <button
          type="button"
          className="openui-btn openui-btn-secondary"
          onClick={() => triggerAction(props.cancelLabel)}
          disabled={isEffectivelyDisabled}
        >
          {props.cancelLabel}
        </button>
        {superseded && (
          <span className="openui-superseded-banner" data-testid="openui-superseded-banner">
            (Superseded by updated request)
          </span>
        )}
      </div>
    );
  },
});

/**
 * BalaBot bounded component library
 */
export const balabotLibrary = createLibrary({
  root: 'HireAgentCard',
  components: [HireAgentCard, Card, CardHeader, FormField, ConfirmButtons],
});

/**
 * Pre-generated system prompt instructions block for BalaBot agents
 */
export const balabotSystemPrompt = balabotLibrary.prompt({ inlineMode: true });
