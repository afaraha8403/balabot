import {useRef, useState} from 'react';
import {ChatComposer} from '@astryxdesign/core/Chat';
import {ChatComposerInput} from '@astryxdesign/core/Chat';
import {ChatComposerDrawer} from '@astryxdesign/core/Chat';
import {ChatDictationButton} from '@astryxdesign/core/Chat';
import {useChatDictation} from '@astryxdesign/core/Chat';
import type {ChatComposerInputHandle} from '@astryxdesign/core/Chat';
import {Token} from '@astryxdesign/core/Token';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';

export type Attachment = {id: string; name: string};

type Props = {
  isStreaming: boolean;
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  isDisabled?: boolean;
};

export function Composer({isStreaming, onSubmit, onStop, isDisabled}: Props) {
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
    onSubmit(text, attachments);
    setValue('');
    setAttachments([]);
  };

  const addFiles = (files: File[]) => {
    const next = files.map(f => ({
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
    }));
    setAttachments(prev => [...prev, ...next]);
  };

  return (
    <ChatComposer
      value={value}
      onChange={setValue}
      onSubmit={() => submit()}
      onStop={onStop}
      isStopShown={isStreaming}
      isDisabled={isDisabled}
      placeholder={`Message…`}
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
                  icon={<Icon icon="externalLink" />}
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
        <IconButton
          label="Attach file"
          size="sm"
          variant="ghost"
          icon={<Icon icon="externalLink" />}
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
      }
      input={
        <ChatComposerInput
          handleRef={inputRef}
          value={value}
          onChange={setValue}
          onSubmit={() => submit()}
          onFiles={addFiles}
          maxRows={6}
          label="Message input"
        />
      }
      sendActions={<ChatDictationButton dictation={dictation} size="md" />}
    />
  );
}