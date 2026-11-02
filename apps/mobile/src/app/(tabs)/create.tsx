import { Screen, Section } from '@/components/ui/Screen';
import { Notice } from '@/components/ui/Notice';
import { Text } from 'react-native';
import { VIDEO_LIMITS } from '@crave/core';
import { colors, type } from '@/theme';

export default function CreateScreen() {
  return (
    <Screen title="Create" subtitle="Share the meals you crave.">
      <Notice tone="warning" title="Video uploads arrive in Phase 4" body="Recording/uploading, tagging verified restaurants and menu items, sponsorship disclosure and rights confirmation are designed in the database and validated server-side rules, but the upload screen isn’t built yet." />
      <Section title="Upload rules (already enforced by the backend)">
        <Text style={{ ...type.body, color: colors.textMuted }}>
          • MP4 or MOV, up to {VIDEO_LIMITS.maxBytes / 1024 / 1024} MB{'\n'}
          • {VIDEO_LIMITS.minDurationMs / 1000}s – {VIDEO_LIMITS.maxDurationMs / 60000} minutes{'\n'}
          • You must own the video or have permission to upload it{'\n'}
          • Paid or gifted content must be disclosed{'\n'}
          • Dish tags become orderable only after the restaurant approves them
        </Text>
      </Section>
    </Screen>
  );
}
