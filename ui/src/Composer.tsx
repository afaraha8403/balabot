import {useLayoutEffect, useMemo, useRef, useState} from 'react';
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
import {Plus} from 'lucide-react';
import {HoldEverythingControl} from './HoldEverythingControl';
import {
  uploadAttachment,
  type Attachment,
  type Bot,
  type Group,
  type SkillEntry,
  type InterventionPayload,
} from './api';

const ATTACHMENT_ACCEPT = '.txt,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp,.json,.csv,.py,.js,.ts,.html,.css';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function syncHeight() {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = '0px';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
    }

    syncHeight();
    let lastWidth = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const width = textarea.getBoundingClientRect().width;
      if (width === lastWidth) return;
      lastWidth = width;
      syncHeight();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  function isFilePaste(clipboardData: Pick<DataTransfer, 'files' | 'items'> | null | undefined): boolean {
    if (!clipboardData) return false;
    return (clipboardData.files?.length ?? 0) > 0;
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardData = event.clipboardData;
    if (isDisabled || !clipboardData || !isFilePaste(clipboardData)) return;
    event.preventDefault();
    void addFiles(Array.from(clipboardData.files));
    const text = clipboardData.getData('text/plain');
    if (!text) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextVal = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setValue(nextVal);
    const caret = start + text.length;
    window.requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  const dictation = useChatDictation({
    inputRef,
    onResult: (text: string) => {
      setValue(prev => (prev ? `${prev} ${text}` : text));
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
    <fieldset
      aria-label="Message composer"
      data-testid="composer-fieldset"
      onKeyDown={onKeyDown}
      className="polaris-composer-fieldset rounded-full border border-border bg-background relative z-30 m-0 min-w-0 border-0 px-3 pb-4 pt-3 md:px-6 md:pb-6"
    >
      {replyingTo ? (
        <HStack
          gap={2}
          vAlign="center"
          justify="between"
          padding={2}
          style={{
            backgroundColor: 'var(--muted)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--spacing-1)',
            borderLeft: 'var(--spacing-0-5) solid var(--accent)',
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

      {attachments.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          {attachments.map(a => (
            <div key={a.id} className="polaris-attachment-chip">
              <IconFile />
              <span style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex' }}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        data-testid="composer-bar"
        className="polaris-composer-bar flex items-center gap-3.5 rounded-full border border-border bg-background py-[9px] pe-2.5 ps-3 transition-colors focus-within:border-ring"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          style={{ display: 'none' }}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              void addFiles(Array.from(event.target.files));
              event.target.value = '';
            }
          }}
        />
        <button
          type="button"
          aria-label="Attach file"
          disabled={isDisabled}
          onClick={() => fileInputRef.current?.click()}
          className="polaris-composer-btn-attach size-8 shrink-0 rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus size={16} strokeWidth={2} />
        </button>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent.isComposing || e.keyCode === 229)) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={isDisabled}
            placeholder={botName ? `Message ${botName}` : 'Message…'}
            aria-label={botName ? `Message ${botName}` : 'Message'}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            name="chat-message"
            autoComplete="off"
            dir="auto"
            rows={1}
            className="polaris-composer-textarea max-h-32 min-h-[24px] min-w-[8rem] flex-1 resize-none overflow-y-auto bg-transparent py-0.5 text-[15.5px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40"
          />
        </div>

        {!value.trim() && onStartVoiceChat ? (
          <Button
            label="Start voice chat"
            size="sm"
            variant="ghost"
            icon={<IconMicrophone />}
            onClick={onStartVoiceChat}
          />
        ) : null}

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

        <ChatDictationButton dictation={dictation} size="md" />

        <button
          type="button"
          aria-label={isStreaming ? "Stop" : "Send"}
          onClick={() => (isStreaming ? onStop() : submit())}
          className="polaris-composer-btn-send"
        >
          {isStreaming ? "■" : "↑"}
        </button>
      </div>
    </fieldset>
  );
}