-- Published videos are copied as-is from video-uploads to video-playback. iPhone uploads are
-- QuickTime (.mov), which the playback bucket rejected, so publishing an iPhone video failed.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'video/quicktime')
 where id = 'video-playback' and not ('video/quicktime' = any(allowed_mime_types));
