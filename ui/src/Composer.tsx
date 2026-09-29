import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ChatComposer} from '@astryxdesign/core/Chat';
import {ChatComposerInput} from '@astryxdesign/core/Chat';
import {ChatComposerDrawer} from '@astryxdesign/core/Chat';
import {useChatDictation} from '@astryxdesign/core/Chat';
import type {ChatComposerInputHandle, ChatComposerTrigger} from '@astryxdesign/core/Chat';
import {createStaticSource} from '@astryxdesign/core/Typeahead';
import {Token} from '@astryxdesign/core/Token';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {IconAttach, IconClose, IconFile} from './icons';
import {Plus, Box, Paperclip, X, Bot as BotIcon, Users, Radio, Settings, Mic, ArrowUp, Square} from 'lucide-react';
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
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB upload ceiling

function isFileTypeSupported(file: File): boolean {
  const parts = file.name.split('.');
  if (parts.length < 2) return false;
  const ext = '.' + parts.pop()!.toLowerCase();
  const accepted = ATTACHMENT_ACCEPT.split(',').map(s => s.trim().toLowerCase());
  return accepted.includes(ext);
}

function botHasVision(bot?: Bot | null): boolean {
  if (!bot) return false;
  if ((bot as any).hasVision === true) return true;
  if (Array.isArray((bot as any).capabilities) && (bot as any).capabilities.includes('vision')) return true;
  const model = ((bot as any).model || '').toLowerCase();
  if (['gpt-4o', 'gemini', 'claude-3', 'sonnet', 'vision'].some(v => model.includes(v))) return true;
  return false;
}

export type ComposerMentionKind = 'bot' | 'group' | 'routine' | 'connector' | 'everyone';

export type ComposerMention = {
  kind: ComposerMentionKind;
  id: string;
  name: string;
  subtitle?: string;
  color?: string;
};

function MentionChipIcon({ mention }: { mention: ComposerMention }) {
  if (mention.kind === 'bot') {
    return <BotIcon size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />;
  }
  if (mention.kind === 'group' || mention.kind === 'everyone') {
    return <Users size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />;
  }
  return <Radio size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />;
}

export type MentionPickerKeyAction =
  | { type: 'complete'; index: number }
  | { type: 'move'; index: number }
  | { type: 'dismiss' }
  | { type: 'send' }
  | { type: 'none' };

export function wrapMentionHighlightIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function clampMentionHighlightIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function resolveMentionPickerKey(input: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  optionCount: number;
  highlightedIndex: number;
}): MentionPickerKeyAction {
  if (input.isComposing) return { type: 'none' };

  const { key, shiftKey = false, optionCount } = input;
  const highlightedIndex = clampMentionHighlightIndex(input.highlightedIndex, optionCount);

  if (optionCount > 0) {
    if (key === 'ArrowDown') {
      return { type: 'move', index: wrapMentionHighlightIndex(highlightedIndex + 1, optionCount) };
    }
    if (key === 'ArrowUp') {
      return { type: 'move', index: wrapMentionHighlightIndex(highlightedIndex - 1, optionCount) };
    }
    if (key === 'Enter' && !shiftKey) {
      return { type: 'complete', index: highlightedIndex };
    }
    if (key === 'Tab') {
      return { type: 'complete', index: highlightedIndex };
    }
    if (key === 'Escape') {
      return { type: 'dismiss' };
    }
    return { type: 'none' };
  }

  if (key === 'Enter' && !shiftKey) {
    return { type: 'send' };
  }
  return { type: 'none' };
}

export function truncateSlashDescription(value?: string, max = 72): string {
  if (!value) return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function serializeComposerPrompt(
  draft: string,
  skill: { name: string } | null,
  mentions: Array<{ name: string }>,
): string {
  const body = draft.replace(/^\s+/, '');
  const mentionPrefix = mentions.map(member => `@${member.name}`).join(' ');
  const afterSkill = [mentionPrefix, body].filter(part => part.trim().length > 0).join(' ');
  if (!skill) return afterSkill.trimEnd();
  return afterSkill.trim().length > 0 ? `/${skill.name}\n${afterSkill}` : `/${skill.name}`;
}

export type ComposerAttachment = Attachment & {
  previewUrl?: string;
  isQueued?: boolean;
};

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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<ComposerMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);

  const currentBot = useMemo(() => bots.find(b => b.id === botId), [bots, botId]);
  const activeBotHasVision = useMemo(() => botHasVision(currentBot), [currentBot]);
  const hasImageAttachment = useMemo(
    () =>
      attachments.some(
        a => a.mime_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name),
      ),
    [attachments],
  );

  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim().toLowerCase();
    const all: ComposerMention[] = [];
    if ('everyone'.startsWith(query)) {
      all.push({
        kind: 'everyone',
        id: 'everyone',
        name: 'everyone',
        subtitle: 'Everyone in this group',
      });
    }
    for (const b of bots) {
      if (!query || b.name.toLowerCase().startsWith(query)) {
        all.push({
          kind: 'bot',
          id: b.id,
          name: b.name,
          subtitle: 'Bot',
        });
      }
    }
    for (const g of groups) {
      if (!query || g.name.toLowerCase().startsWith(query)) {
        all.push({
          kind: 'group',
          id: g.id,
          name: g.name,
          subtitle: 'Group',
        });
      }
    }
    return all.slice(0, 10);
  }, [mentionQuery, bots, groups]);

  useEffect(() => {
    setMentionHighlightIndex(0);
  }, [mentionQuery, mentionOptions]);

  const activeMentionIndex = clampMentionHighlightIndex(
    mentionHighlightIndex,
    mentionOptions.length,
  );
  const mentionPickerOpen = mentionOptions.length > 0;
  const mentionListboxId = 'composer-mentions-listbox';
  const activeMentionOptionId = mentionPickerOpen
    ? `${mentionListboxId}-option-${activeMentionIndex}`
    : undefined;

  const [slashQuery, setSlashQuery] = useState<string | null>(null);

  const slashSkillOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim().toLowerCase();
    const list = skills ?? [];
    return list
      .filter(s => {
        if (!query) return true;
        return s.name.toLowerCase().includes(query) || (s.description && s.description.toLowerCase().includes(query));
      })
      .slice(0, 8);
  }, [skills, slashQuery]);

  const slashActionOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim().toLowerCase();
    const baseActions = [
      { id: 'chat-settings', label: 'Chat Settings' },
      { id: 'settings-general', label: 'Settings: General' },
      { id: 'settings-usage', label: 'Settings: Usage' },
      ...(skills.length === 0
        ? [
            { id: 'no-skills', label: 'No skills installed' },
            { id: 'skill-library', label: 'Open Skill Library' },
          ]
        : [{ id: 'skill-library', label: 'Open Skill Library' }]),
    ];
    return baseActions.filter(a => !query || a.label.toLowerCase().includes(query));
  }, [skills, slashQuery]);

  const showSlashPicker =
    slashQuery !== null &&
    mentionQuery === null &&
    (slashSkillOptions.length > 0 || slashActionOptions.length > 0);

  function updateDraft(text: string) {
    setValue(text);
    const mentionMatch = /(?:^|\s)@([\w-]*)$/.exec(text);
    setMentionQuery(mentionMatch ? (mentionMatch[1] ?? '') : null);
    const slashMatch = selectedSkill === null ? /^\/([^\n]*)$/.exec(text) : null;
    setSlashQuery(slashMatch ? (slashMatch[1] ?? '') : null);
  }

  function insertSkill(skill: SkillEntry) {
    setSelectedSkill(skill);
    setValue('');
    setSlashQuery(null);
    textareaRef.current?.focus();
  }

  function runSlashAction(actionId: string) {
    setValue('');
    setSlashQuery(null);
    if (actionId === 'skill-library') {
      onNotify?.('Opening Skill Library');
    } else {
      onNotify?.(`Action: ${actionId}`);
    }
    textareaRef.current?.focus();
  }

  function insertMention(mention: ComposerMention) {
    setValue(current => current.replace(/@([\w-]*)$/, ''));
    setMentionQuery(null);
    setMentionHighlightIndex(0);
    setSelectedMentions(current =>
      current.some(selected => `${selected.kind}:${selected.id}` === `${mention.kind}:${mention.id}`)
        ? current
        : [...current, mention],
    );
    textareaRef.current?.focus();
  }
  const [replyAnnouncement, setReplyAnnouncement] = useState('');
  const replyAnnouncementKind = useRef<'reply' | 'cancelled' | null>(null);
  const prevReplyTarget = useRef<{sender: string; text: string} | null>(null);
  const announceTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  useEffect(() => {
    const prev = prevReplyTarget.current;
    prevReplyTarget.current = replyingTo ?? null;
    if (!replyingTo) {
      window.clearTimeout(announceTimer.current);
      if (replyAnnouncementKind.current === 'reply') {
        replyAnnouncementKind.current = null;
        setReplyAnnouncement('');
      }
      return;
    }
    if (!prev || prev.text !== replyingTo.text || prev.sender !== replyingTo.sender) {
      textareaRef.current?.focus();
      setReplyAnnouncement('');
      replyAnnouncementKind.current = null;
      window.clearTimeout(announceTimer.current);
      announceTimer.current = window.setTimeout(() => {
        replyAnnouncementKind.current = 'reply';
        setReplyAnnouncement(`Replying to ${replyingTo.sender}`);
      }, 50);
    }
  }, [replyingTo]);

  const dragDepth = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  function removeLastChip() {
    if (selectedMentions.length > 0) {
      setSelectedMentions(current => current.slice(0, -1));
      return;
    }
    if (selectedSkill) setSelectedSkill(null);
  }

  function isFileDrag(dataTransfer: Pick<DataTransfer, 'types' | 'items'> | null): boolean {
    if (!dataTransfer) return false;
    return (
      Array.from(dataTransfer.types).includes('Files') ||
      Array.from(dataTransfer.items).some(item => item.kind === 'file')
    );
  }

  function handleDragEnter(event: React.DragEvent<HTMLFieldSetElement>) {
    const dataTransfer = event.dataTransfer;
    if (!isFileDrag(dataTransfer)) return;
    event.preventDefault();
    if (isDisabled) {
      dragDepth.current = 0;
      setDraggingFiles(false);
      return;
    }
    dragDepth.current += 1;
    setDraggingFiles(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLFieldSetElement>) {
    const dataTransfer = event.dataTransfer;
    if (!isFileDrag(dataTransfer)) return;
    event.preventDefault();
    dataTransfer.dropEffect = isDisabled ? 'none' : 'copy';
    if (isDisabled) {
      dragDepth.current = 0;
      setDraggingFiles(false);
      return;
    }
    setDraggingFiles(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLFieldSetElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    if (isDisabled) {
      dragDepth.current = 0;
      setDraggingFiles(false);
      return;
    }
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingFiles(false);
  }

  function handleDrop(event: React.DragEvent<HTMLFieldSetElement>) {
    const dataTransfer = event.dataTransfer;
    if (!isFileDrag(dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFiles(false);
    if (!isDisabled && dataTransfer.files) void addFiles(Array.from(dataTransfer.files));
  }

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

  const canSend = Boolean(
    value.trim() ||
    attachments.length > 0 ||
    selectedSkill !== null ||
    selectedMentions.length > 0
  );

  const submit = () => {
    if (!canSend || isDisabled) return;
    const text = serializeComposerPrompt(value, selectedSkill, selectedMentions);
    if (!text && attachments.length === 0) return;
    onSubmit(text, attachments, replyingTo ?? undefined);
    setValue('');
    setAttachments([]);
    setSelectedSkill(null);
    setSelectedMentions([]);
    setMentionQuery(null);
    setSlashQuery(null);
    onCancelReply?.();
  };

  const addFiles = async (files: File[]) => {
    setAttachmentError(null);
    const validFiles: File[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setAttachmentError(`File "${f.name}" is too large (${(f.size / (1024 * 1024)).toFixed(1)} MB). Exceeds the 25 MB limit.`);
        continue;
      }
      if (!isFileTypeSupported(f)) {
        const parts = f.name.split('.');
        const ext = parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : 'unknown';
        setAttachmentError(`Unsupported file type "${ext}" for "${f.name}". Accepted types: ${ATTACHMENT_ACCEPT}`);
        continue;
      }
      validFiles.push(f);
    }
    if (validFiles.length === 0) return;

    const uploaded = await Promise.all(
      validFiles.map(async f => {
        const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
        try {
          const res = await uploadAttachment(f);
          return {
            ...res,
            previewUrl,
            isQueued: isStreaming,
          };
        } catch {
          return {
            id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: f.name,
            size: f.size,
            mime_type: f.type,
            previewUrl,
            isQueued: isStreaming,
          };
        }
      }),
    );
    setAttachments(prev => [...prev, ...uploaded]);
  };

  const removeAttachment = (attachment: ComposerAttachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachments(prev => prev.filter(x => x.id !== attachment.id));
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
      data-dragging={draggingFiles ? "files" : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={onKeyDown}
      className={`polaris-composer-fieldset rounded-full border border-border bg-background relative z-30 m-0 min-w-0 border-0 px-3 pb-4 pt-3 md:px-6 md:pb-6 ${
        draggingFiles ? "rounded-[14px] ring-2 ring-inset ring-ring" : ""
      }`}
    >
      <div role="status" data-testid="composer-announcement" className="sr-only">
        {replyAnnouncement}
      </div>

      {replyingTo ? (
        <div
          data-testid="reply-chip"
          className="polaris-reply-chip mb-2 flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-[13px] text-foreground/75"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
        >
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            Replying to {replyingTo.sender}: &ldquo;{replyingTo.text}&rdquo;
          </span>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={() => {
              replyAnnouncementKind.current = 'cancelled';
              window.clearTimeout(announceTimer.current);
              onCancelReply?.();
              setReplyAnnouncement('Reply cancelled');
              textareaRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex', padding: 0 }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      {attachmentError ? (
        <div
          data-testid="composer-attachment-error"
          className="polaris-attachment-error mb-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[13px] text-destructive"
        >
          <span>{attachmentError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setAttachmentError(null)}
            className="shrink-0 text-destructive hover:opacity-80"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      {hasImageAttachment && !activeBotHasVision ? (
        <div
          data-testid="composer-vision-notice"
          className="polaris-vision-notice mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[13px] text-amber-500"
        >
          <span>Active bot has no vision capability — images cannot be seen or analysed.</span>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          {attachments.map(a => (
            <div
              key={a.id}
              className="polaris-attachment-chip flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-[13px] text-foreground/75"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              {a.previewUrl ? (
                <img
                  src={a.previewUrl}
                  alt={a.name}
                  className="h-8 w-8 rounded object-cover"
                  style={{ height: '32px', width: '32px', borderRadius: '4px', objectFit: 'cover' }}
                />
              ) : (
                <Paperclip size={14} strokeWidth={1.8} />
              )}
              <span
                className="max-w-[180px] truncate"
                style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                dir="auto"
              >
                {a.name}
              </span>
              {!activeBotHasVision && (a.mime_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name)) ? (
                <span className="text-[11.5px] text-amber-500 font-medium">
                  (no vision capability — cannot be seen)
                </span>
              ) : null}
              {a.isQueued || isStreaming ? (
                <span className="text-[11.5px] text-muted-foreground font-medium">
                  queued for the next step
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a)}
                className="text-muted-foreground hover:text-foreground"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex', padding: 0 }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {mentionPickerOpen ? (
        <div
          id={mentionListboxId}
          role="listbox"
          aria-label="Mentions"
          data-testid="mention-picker"
          className="polaris-mention-picker mb-2 overflow-hidden rounded-[14px] border border-border bg-muted"
        >
          {mentionOptions.map((mention, index) => {
            const optionId = `${mentionListboxId}-option-${index}`;
            const highlighted = index === activeMentionIndex;
            return (
              <button
                id={optionId}
                key={`${mention.kind}:${mention.id}`}
                type="button"
                role="option"
                aria-selected={highlighted}
                aria-label={`@${mention.name}`}
                data-highlighted={highlighted ? "true" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(mention)}
                onMouseEnter={() => setMentionHighlightIndex(index)}
                className={`polaris-picker-option flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent ${
                  highlighted ? "bg-accent" : ""
                }`}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 16px',
                  border: 'none',
                  background: highlighted ? 'var(--accent)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <MentionChipIcon mention={mention} />
                <span className="min-w-0" style={{ flex: 1 }}>
                  <span dir="auto" className="block text-[14px] text-foreground" style={{ display: 'block', fontWeight: 500 }}>
                    @{mention.name}
                  </span>
                  {mention.subtitle ? (
                    <span dir="auto" className="block truncate text-[12.5px] text-muted-foreground" style={{ display: 'block', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                      {mention.subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {showSlashPicker ? (
        <div
          data-testid="slash-picker"
          className="polaris-slash-picker mb-2 overflow-hidden rounded-[14px] border border-border bg-muted"
          style={{
            marginBottom: '8px',
            overflow: 'hidden',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--popover, var(--muted))',
          }}
        >
          {slashSkillOptions.map((skill) => (
            <button
              key={skill.name}
              type="button"
              aria-label={`Skill ${skill.name}`}
              onClick={() => insertSkill(skill)}
              className="polaris-picker-option flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent"
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '10px 16px',
                border: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Box size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted-foreground" style={{ marginTop: '2px', flexShrink: 0, color: 'var(--muted-foreground)' }} />
              <span className="min-w-0" style={{ flex: 1 }}>
                <span dir="auto" className="block text-[14px] text-foreground" style={{ display: 'block', fontWeight: 500 }}>
                  {skill.name}
                </span>
                {skill.description ? (
                  <span dir="auto" className="block truncate text-[12.5px] text-muted-foreground" style={{ display: 'block', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                    {truncateSlashDescription(skill.description)}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {slashActionOptions.map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              onClick={() => runSlashAction(action.id)}
              className="polaris-picker-option flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-accent"
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 16px',
                border: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Settings size={16} strokeWidth={1.7} className="shrink-0 text-muted-foreground" style={{ flexShrink: 0, color: 'var(--muted-foreground)' }} />
              <span className="text-[14px] text-foreground" style={{ fontWeight: 500 }}>
                {action.label}
              </span>
            </button>
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

        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}
        >
          {selectedSkill ? (
            <span
              data-testid="skill-chip"
              className="polaris-token-chip inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Box size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />
              <span dir="auto" className="truncate">
                {selectedSkill.name}
              </span>
              <button
                type="button"
                aria-label={`Remove skill ${selectedSkill.name}`}
                onClick={() => setSelectedSkill(null)}
                className="text-muted-foreground hover:text-foreground"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex', padding: 0 }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ) : null}
          {selectedMentions.map(mention => (
            <span
              key={`${mention.kind}:${mention.id}`}
              data-testid="mention-chip"
              data-mention-kind={mention.kind}
              className="polaris-token-chip inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <MentionChipIcon mention={mention} />
              <span dir="auto" className="truncate">
                {mention.name}
              </span>
              <button
                type="button"
                aria-label={`Remove mention ${mention.name}`}
                onClick={() =>
                  setSelectedMentions(current =>
                    current.filter(m => `${m.kind}:${m.id}` !== `${mention.kind}:${mention.id}`),
                  )
                }
                className="text-muted-foreground hover:text-foreground"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex', padding: 0 }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => updateDraft(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (
                e.key === 'Backspace' &&
                value.length === 0 &&
                (selectedSkill !== null || selectedMentions.length > 0)
              ) {
                e.preventDefault();
                removeLastChip();
                return;
              }
              if (e.key === 'Escape' && slashQuery !== null) {
                e.preventDefault();
                setSlashQuery(null);
                return;
              }
              const action = resolveMentionPickerKey({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing || e.keyCode === 229,
                optionCount: mentionOptions.length,
                highlightedIndex: activeMentionIndex,
              });
              if (action.type === 'complete') {
                const mention = mentionOptions[action.index];
                if (!mention) return;
                e.preventDefault();
                insertMention(mention);
                return;
              }
              if (action.type === 'move') {
                e.preventDefault();
                setMentionHighlightIndex(action.index);
                return;
              }
              if (action.type === 'dismiss') {
                e.preventDefault();
                setMentionQuery(null);
                setMentionHighlightIndex(0);
                return;
              }
              if (action.type === 'send') {
                e.preventDefault();
                submit();
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (onStartVoiceChat) {
                  onStartVoiceChat();
                } else {
                  dictation.toggle();
                }
                return;
              }
            }}
            disabled={isDisabled}
            placeholder={botName ? `Message ${botName}` : 'Message…'}
            aria-label={botName ? `Message ${botName}` : 'Message'}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={mentionPickerOpen}
            aria-controls={mentionPickerOpen ? mentionListboxId : undefined}
            aria-activedescendant={activeMentionOptionId}
            name="chat-message"
            autoComplete="off"
            dir="auto"
            rows={1}
            className="polaris-composer-textarea max-h-32 min-h-[24px] min-w-[8rem] flex-1 resize-none overflow-y-auto bg-transparent py-0.5 text-[15.5px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40"
          />
        </div>

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

        <button
          type="button"
          aria-label={dictation.isListening ? 'Stop voice' : 'Voice'}
          title={dictation.isListening ? 'Stop voice' : 'Voice'}
          disabled={isDisabled}
          onClick={() => {
            if (onStartVoiceChat) {
              onStartVoiceChat();
            } else {
              dictation.toggle();
            }
          }}
          className={`polaris-composer-btn-voice size-8 shrink-0 rounded-full text-foreground/75 ${
            dictation.isListening ? 'bg-destructive/20 text-destructive' : ''
          }`}
          style={
            dictation.isListening
              ? { backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'rgb(239, 68, 68)' }
              : undefined
          }
        >
          <Mic size={16} strokeWidth={1.8} />
        </button>

        {isStreaming ? (
          <div
            className="flex items-center gap-1.5 shrink-0"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
          >
            <button
              type="button"
              aria-label="Send"
              disabled={!canSend || isDisabled}
              onClick={submit}
              className="polaris-composer-btn-send size-8 rounded-full bg-white text-black hover:bg-white/90 shadow-sm transition-transform active:scale-95"
            >
              <ArrowUp size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className="polaris-composer-btn-stop size-8 rounded-full border border-border bg-muted text-foreground/80 shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <Square size={11} strokeWidth={0} fill="currentColor" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!canSend || isDisabled}
            onClick={submit}
            className="polaris-composer-btn-send size-8 shrink-0 rounded-full bg-white text-black hover:bg-white/90 shadow-sm transition-transform active:scale-95 disabled:bg-white/10 disabled:text-muted-foreground/30 disabled:shadow-none"
          >
            <ArrowUp size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </fieldset>
  );
}