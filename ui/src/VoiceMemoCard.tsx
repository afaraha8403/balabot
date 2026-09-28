import {useRef, useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {IconPause, IconPlay, IconVoiceMemo} from './icons';
import type {VoiceMemoData} from './api';

type Props = {
  memo: VoiceMemoData;
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Voice memo card (GrokBot spec):
 * Renders an in-conversation voice memo from a Bot with Play/Pause audio
 * playback and an expandable transcript.
 */
export function VoiceMemoCard({memo}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current && memo.audioUrl) {
      audioRef.current = new Audio(memo.audioUrl);
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play();
        setIsPlaying(true);
      }
    } else {
      // Toggle play state indicator if no actual audioUrl is attached
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <Card variant="muted" padding={3}>
      <VStack gap={2}>
        <HStack gap={3} vAlign="center" justify="between">
          <HStack gap={2} vAlign="center">
            <IconButton
              label={isPlaying ? 'Pause voice memo' : 'Play voice memo'}
              size="sm"
              variant="secondary"
              icon={isPlaying ? <IconPause /> : <IconPlay />}
              onClick={togglePlay}
            />
            <HStack gap={1} vAlign="center">
              <IconVoiceMemo size="sm" color="accent" />
              <Text type="body" weight="medium">
                Voice memo
              </Text>
            </HStack>
          </HStack>
          <Text type="supporting" size="sm" color="secondary">
            {formatDuration(memo.durationSec)}
          </Text>
        </HStack>

        <Collapsible
          defaultIsOpen={false}
          trigger={
            <Text type="supporting" size="xsm" color="accent" style={{cursor: 'pointer'}}>
              Transcript
            </Text>
          }
        >
          <Card variant="default" padding={3}>
            <Text type="supporting" color="secondary">
              {memo.transcript || 'No transcript available.'}
            </Text>
          </Card>
        </Collapsible>
      </VStack>
    </Card>
  );
}
