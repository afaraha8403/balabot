import React from 'react';
import { Renderer } from '@openuidev/react-lang';
import type { ActionEvent } from '@openuidev/lang-core';
import { ChatMarkdown } from '../ChatMarkdown';
import { balabotLibrary } from './library';
import { OpenUIContext } from './OpenUIContext';
import './openui.css';

export * from './descriptor';
export * from './OpenUIContext';

interface Props {
  content: string;
  isStreaming?: boolean;
  onAction?: (event: ActionEvent) => void;
  disabled?: boolean;
  superseded?: boolean;
}

interface ParsedMessageParts {
  hasOpenUI: boolean;
  before: string;
  openuiCode: string;
  after: string;
}

/**
 * Extracts OpenUI Lang code from message content.
 * Supports triple-backtick fences (```openui-lang ... ``` or ```openui ... ```)
 * as well as raw openui statements (root = ...).
 * Also tolerates untagged fences whose body starts with root= / root =.
 */
export function extractOpenUI(content: string): ParsedMessageParts {
  if (!content) {
    return { hasOpenUI: false, before: '', openuiCode: '', after: '' };
  }

  // Look for ```openui-lang or ```openui fence
  const taggedFenceRegex = /```(?:openui-lang|openui)\s*\n?([\s\S]*?)(?:```|$)/i;
  const taggedMatch = content.match(taggedFenceRegex);

  if (taggedMatch && taggedMatch.index !== undefined) {
    const before = content.slice(0, taggedMatch.index).trim();
    const openuiCode = taggedMatch[1].trim();
    const after = content.slice(taggedMatch.index + taggedMatch[0].length).trim();
    return {
      hasOpenUI: openuiCode.length > 0,
      before,
      openuiCode,
      after,
    };
  }

  // Look for untagged fence whose body starts with root= / root =
  const untaggedFenceRegex = /```\s*\n?([\s\S]*?)(?:```|$)/;
  const untaggedMatch = content.match(untaggedFenceRegex);

  if (untaggedMatch && untaggedMatch.index !== undefined) {
    const fenceBody = untaggedMatch[1].trim();
    if (fenceBody.startsWith('root =') || fenceBody.startsWith('root=')) {
      const before = content.slice(0, untaggedMatch.index).trim();
      const after = content.slice(untaggedMatch.index + untaggedMatch[0].length).trim();
      return {
        hasOpenUI: true,
        before,
        openuiCode: fenceBody,
        after,
      };
    }
  }

  // Raw OpenUI Lang without markdown fences (e.g. root = ...)
  const trimmed = content.trim();
  if (trimmed.startsWith('root =') || trimmed.startsWith('root=')) {
    return {
      hasOpenUI: true,
      before: '',
      openuiCode: trimmed,
      after: '',
    };
  }

  return { hasOpenUI: false, before: content, openuiCode: '', after: '' };
}

/**
 * Polaris OpenUIRenderer:
 * Dual-mode renderer that renders standard chat Markdown via ChatMarkdown
 * and seamlessly embeds interactive OpenUI components inside chat messages.
 */
export function OpenUIRenderer({
  content,
  isStreaming = false,
  onAction,
  disabled = false,
  superseded = false,
}: Props) {
  const parts = extractOpenUI(content);

  if (!parts.hasOpenUI) {
    return <ChatMarkdown streaming={isStreaming}>{content}</ChatMarkdown>;
  }

  const containerClass = [
    'openui-bubble-container',
    disabled ? 'openui-disabled' : '',
    superseded ? 'openui-superseded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <OpenUIContext.Provider value={{ disabled, superseded }}>
      <div className={containerClass}>
        {parts.before ? (
          <ChatMarkdown streaming={false}>{parts.before}</ChatMarkdown>
        ) : null}

        <div style={{ margin: '8px 0' }}>
          <Renderer
            library={balabotLibrary}
            response={parts.openuiCode}
            isStreaming={isStreaming}
            onAction={onAction}
          />
        </div>

        {parts.after ? (
          <ChatMarkdown streaming={isStreaming}>{parts.after}</ChatMarkdown>
        ) : null}
      </div>
    </OpenUIContext.Provider>
  );
}
