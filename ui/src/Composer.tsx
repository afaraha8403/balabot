import {useMemo, useRef, useState} from 'react';
import {ChatComposer} from '@astryxdesign/core/Chat';
import {ChatComposerInput} from '@astryxdesign/core/Chat';
import {ChatComposerDrawer} from '@astryxdesign/core/Chat';
import {ChatDictationButton} from '@astryxdesign/core/Chat';
import {useChatDictation} from '@astryxdesign/core/Chat';
import type {ChatComposerInputHandle, ChatComposerTrigger} from '@astryxdesign/core/Chat';
import {createStaticSource} from '@astryxdesign/core/Typeahead';
import {Token} from '@astryxdesign/core/Token';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {IconAttach, IconClose, IconFile, IconMicrophone} from './icons';
import {HoldEverythingControl} from './HoldEverythingControl';
import {
  uploadAttachment,
  type Attachment,
  type Bot,
  type Group,
  type SkillEntry,
  type InterventionPayload,
} from './api';

type Props = {
  isStreaming: boolean;
  onSubmit: (text: string, attachments: Attachment[], replyTo?: {sender: string; text: string}) => void;
  onStop: () => void;
  isDisabled?: boolean;
  botName?: string;
  botId?: string;
  bots?: Bot[];
  groups?: Group[];
  skills?: SkillEntry[];
  onStartVoiceChat?: () => void;
  replyingTo?: {sender: string; text: string} | null;
  onCancelReply?: () => void;
  activeIntervention?: InterventionPayload | null;
  onInterventionChange?: (iv: InterventionPayload | null) => void;
  onNotify?: (msg: string) => void;
  onOpenComputer?: () => void;
};

export function Composer({
  isStreaming,
  onSubmit,
  onStop,
  isDisabled,
  botName,
  botId,
  bots = [],
  groups = [],
  skills = [],
  onStartVoiceChat,
  replyingTo,
  onCancelReply,
  activeIntervention,
  onInterventionChange,
  onNotify,
  onOpenComputer,
}: Props) {
  const inputRef = useRef<ChatComposerInputHandle>(null);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const dictation = useChatDictation({
    inputRef,
    onResult: () => {
      /* transcript is inserted into the input via inputRef */
    },
  });

  const submit = () => {
    const text = value.trim();
    if (!text || isDisabled) return;
    onSubmit(text, attachments, replyingTo ?? undefined);
    setValue('');
    setAttachments([]);
    onCancelReply?.();
  };

  const addFiles = async (files: File[]) => {
    const uploaded = await Promise.all(
      files.map(async f => {
        try {
          return await uploadAttachment(f);
        } catch {
          return {
            id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: f.name,
          };
        }
      }),
    );
    setAttachments(prev => [...prev, ...uploaded]);
  };

  const triggers: ChatComposerTrigger[] = useMemo(() => {
    const list: ChatComposerTrigger[] = [];

    // @ mention trigger: bots, groups, and @everyone (GrokBot spec)
    const mentionItems = [
      ...bots.map(b => ({id: b.id, label: b.name})),
      ...groups.map(g => ({id: g.id, label: g.name})),
      {id: 'everyone', label: 'everyone'},
    ];
    if (mentionItems.length > 0) {
      list.push({
        character: '@',
        searchSource: createStaticSource(mentionItems),
        onSelect: item => `@${item.label} `,
        menuLabel: 'Mention Bot or Group',
      });
    }

    // / slash trigger: reference skills and slash actions (Polaris parity)
    const slashItems = [
      ...skills.map(s => ({id: s.name, label: s.name})),
      {id: 'chat-settings', label: 'chat settings'},
      {id: 'settings-general', label: 'settings: general'},
      {id: 'settings-usage', label: 'settings: usage'},
      ...(skills.length === 0
        ? [
            {id: 'no-skills', label: 'no skills installed'},
            {id: 'skill-library', label: 'open skill library'},
          ]
        : []),
    ];

    list.push({
      character: '/',
      searchSource: createStaticSource(slashItems),
      onSelect: item => `/${item.label} `,
      menuLabel: 'Reference Skill & Actions',
    });

    return list;
  }, [bots, groups, skills]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl+D: toggle dictation while prompt is focused (GrokBot shortcut)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      if (dictation.isListening) {
        dictation.stop();
      } else {
        dictation.start();
      }
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      {replyingTo ? (
        <HStack
          gap={2}
          vAlign="center"
          justify="between"
          padding={2}
          style={{
            backgroundColor: 'var(--muted)',
            borderRadius: 'var(--radius-sm, 4px)',
            marginBottom: '4px',
            borderLeft: '3px solid var(--accent, #6366f1)',
          }}
        >
          <Text type="supporting" size="xsm" color="accent">
            Replying to {replyingTo.sender}: &ldquo;{replyingTo.text.slice(0, 60)}{replyingTo.text.length > 60 ? '…' : ''}&rdquo;
          </Text>
          <IconButton
            label="Cancel reply"
            size="sm"
            variant="ghost"
            icon={<IconClose />}
            onClick={onCancelReply}
          />
        </HStack>
      ) : null}
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={() => submit()}
        onStop={onStop}
        isStopShown={isStreaming}
        isDisabled={isDisabled}
        placeholder={botName ? `Message ${botName}` : 'Message…'}
        drawer={
          attachments.length > 0 ? (
            <ChatComposerDrawer
              count={attachments.length}
              label="Attachments"
              defaultIsCollapsed={false}
            >
              <HStack gap={1} wrap="wrap" padding={2}>
                {attachments.map(a => (
                  <Token
                    key={a.id}
                    label={a.name}
                    icon={<IconFile />}
                    onRemove={() =>
                      setAttachments(prev => prev.filter(x => x.id !== a.id))
                    }
                  />
                ))}
              </HStack>
            </ChatComposerDrawer>
          ) : null
        }
        headerActions={
          <HStack gap={1} vAlign="center" justify="between" width="100%">
            <HStack gap={1} vAlign="center">
              <IconButton
                label="Attach file"
                size="sm"
                variant="ghost"
                icon={<IconAttach />}
                onClick={() => {
                  const el = document.createElement('input');
                  el.type = 'file';
                  el.multiple = true;
                  el.onchange = () => {
                    if (el.files) addFiles(Array.from(el.files));
                  };
                  el.click();
                }}
              />
              {!value.trim() && onStartVoiceChat ? (
                <Button
                  label="Start voice chat"
                  size="sm"
                  variant="ghost"
                  icon={<IconMicrophone />}
                  onClick={onStartVoiceChat}
                />
              ) : null}
            </HStack>

            {botId && onInterventionChange && onNotify ? (
              <HoldEverythingControl
                botId={botId}
                botName={botName || 'Bot'}
                isStreaming={isStreaming}
                onStopStreaming={onStop}
                activeIntervention={activeIntervention ?? null}
                onInterventionChange={onInterventionChange}
                onNotify={onNotify}
                onOpenComputer={onOpenComputer}
              />
            ) : null}
          </HStack>
        }
        input={
          <ChatComposerInput
            handleRef={inputRef}
            value={value}
            onChange={setValue}
            onSubmit={() => submit()}
            onFiles={addFiles}
            maxRows={6}
            label={botName ? `Message ${botName}` : 'Message input'}
            triggers={triggers}
          />
        }
        sendActions={<ChatDictationButton dictation={dictation} size="md" />}
      />
    </div>
  );
}