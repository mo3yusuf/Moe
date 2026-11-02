import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, DemoBanner, Field, ListRow, MissingHint, Screen, T, ToggleRow } from '@/components/ui';
import { TagPicker, type TagChoice } from '@/features/upload/tag-picker';
import { MAX_DURATION_MS, missingForUpload, uploadVideo, validateUpload } from '@/features/upload/upload';
import { config } from '@/lib/config';
import { colors, radius, space } from '@/theme/tokens';

interface Picked { uri: string; durationMs: number; mimeType: 'video/mp4' | 'video/quicktime'; webFile?: Blob | null }

/** Browsers don't always report a picked video's length; read it from the file's metadata. */
function webVideoDurationMs(uri: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
    v.onerror = () => resolve(0);
    setTimeout(() => resolve(0), 8000); // some browsers never fire either event
    v.src = uri;
  });
}

export default function Create() {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [tag, setTag] = useState<TagChoice | null>(null);
  const [sponsored, setSponsored] = useState(false);
  const [disclosure, setDisclosure] = useState('');
  const [reuse, setReuse] = useState(false);
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = picked ? missingForUpload({ caption, durationMs: picked.durationMs, isSponsored: sponsored, sponsorDisclosure: disclosure, rightsConfirmed: rights }) : [];
  const preview = useVideoPlayer(picked ? { uri: picked.uri } : null, (p) => { p.loop = true; p.muted = true; p.play(); });

  async function pick(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', fromCamera ? 'Allow camera access to record a video.' : 'Allow photo library access to choose a video.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], videoMaxDuration: MAX_DURATION_MS / 1000, quality: 1 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    const type = asset.mimeType ?? '';
    if (type && !['video/mp4', 'video/quicktime'].includes(type)) {
      return Alert.alert('Unsupported video', 'Please use an MP4 or MOV video (the normal format from iPhone and Android cameras).');
    }
    const mimeType = type === 'video/quicktime' || asset.uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    // iOS/Android report milliseconds; the web picker reports SECONDS (HTMLVideoElement.duration).
    let durationMs = Platform.OS === 'web' ? Math.round((asset.duration ?? 0) * 1000) : asset.duration ?? 0;
    if (!durationMs && Platform.OS === 'web') durationMs = await webVideoDurationMs(asset.uri);
    // 0 = the browser couldn't tell; the length is then checked during review instead.
    setPicked({ uri: asset.uri, durationMs, mimeType, webFile: (asset as { file?: Blob }).file ?? null });
  }

  async function submit() {
    if (!picked) return;
    const input = { fileUri: picked.uri, mimeType: picked.mimeType, webFile: picked.webFile, durationMs: picked.durationMs, caption, tag: tag ? { restaurantId: tag.restaurantId, menuItemId: tag.menuItemId } : null,
      isSponsored: sponsored, sponsorDisclosure: disclosure, allowRestaurantReuse: reuse, rightsConfirmed: rights };
    const invalid = validateUpload(input);
    if (invalid) return setError(invalid);
    setError(null);
    setProgress(0);
    try {
      await uploadVideo(input, setProgress);
      Alert.alert('Uploaded', 'Your video is in review. We’ll let you know when it’s live — usually within one business day.');
      setPicked(null); setCaption(''); setTag(null); setSponsored(false); setDisclosure(''); setRights(false); setReuse(false);
      router.push('/my-videos');
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : 'please try again'}`);
    } finally {
      setProgress(null);
    }
  }

  if (config.demoMode) {
    return <Screen padded={false}><DemoBanner /><View style={{ padding: space.lg, gap: space.sm }}><T variant="title">Create</T><T muted>Uploading needs a CRAVE account and backend — not available in demo mode.</T></View></Screen>;
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          <T variant="title" accessibilityRole="header">Share a food video</T>
          {!picked ? (
            <Card>
              <T muted>Film a meal you loved at a Brisbane restaurant (up to 3 minutes). Only upload videos you made yourself — don’t copy TikTok or Instagram posts. Mention the restaurant and suburb in your caption.</T>
              <Button title="Record a video" onPress={() => pick(true)} />
              <Button title="Choose from library" variant="secondary" onPress={() => pick(false)} />
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <VideoView player={preview} style={{ width: 120, height: 213, borderRadius: radius.md, backgroundColor: colors.surface }} contentFit="cover" nativeControls={false} />
              <View style={{ flex: 1, gap: space.sm, justifyContent: 'center' }}>
                <T muted>{picked.durationMs ? `${Math.round(picked.durationMs / 1000)} seconds` : 'Video selected'}</T>
                <Button title="Choose a different video" variant="secondary" onPress={() => setPicked(null)} />
              </View>
            </View>
          )}
          {picked ? (
            <>
              <Field label="Caption (required)" value={caption} onChangeText={setCaption} multiline maxLength={500} placeholder="What did you eat? Add #hashtags" style={{ minHeight: 80 }} />
              <TagPicker value={tag} onChange={setTag} />
              <Card>
                <ToggleRow label="Paid or sponsored" description="Required if you were paid, given free food or have any commercial relationship." value={sponsored} onValueChange={setSponsored} />
                {sponsored ? <Field label="Disclosure" value={disclosure} onChangeText={setDisclosure} placeholder={tag ? `Paid partnership with ${tag.restaurantName}` : 'Paid partnership with …'} maxLength={140} /> : null}
                <ToggleRow label="Let the restaurant reuse this video" description="The tagged restaurant may feature it on CRAVE. You can change this later." value={reuse} onValueChange={setReuse} />
                <ToggleRow label="I own this video" description="I filmed it or have permission, including for any music and any people who can be identified." value={rights} onValueChange={setRights} />
              </Card>
              <MissingHint items={missing} />
              {error ? <T style={{ color: colors.danger }} accessibilityLiveRegion="polite">{error}</T> : null}
              <Button title={progress != null ? 'Uploading…' : 'Upload for review'} onPress={submit} loading={progress != null} disabled={missing.length > 0} />
            </>
          ) : null}
          <Card style={{ padding: 0 }}>
            <ListRow title="My videos" subtitle="Review status, views and engagement" onPress={() => router.push('/my-videos')} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
