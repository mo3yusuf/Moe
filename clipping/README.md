# Clipping toolkit (GTA VI launch)

Turn long stream VODs into short vertical clips for TikTok, YouTube Shorts and Reels.

## Setup (once)

```bash
# macOS:   brew install ffmpeg python
# Windows: winget install ffmpeg Python.Python.3.12
pip install numpy faster-whisper    # faster-whisper adds burned-in captions (optional)
pip install yt-dlp                  # downloads VODs you have permission to use
```

TwitchDownloader (free, github.com/lay295/TwitchDownloader) exports a VOD's chat as JSON.
Chat is the strongest highlight signal, so export it whenever you can.

## Daily workflow

```bash
# 1. Get the VOD and its chat
yt-dlp -f "best[height<=1080]" -o vod.mp4 <VOD URL>
TwitchDownloaderCLI chatdownload --id <VOD ID> -o chat.json

# 2. Find the best moments (writes highlights.json, renders nothing)
python3 clipper.py find vod.mp4 --chat chat.json --top 15

# 3. Watch the top timestamps yourself, then cut the good ones
python3 clipper.py cut vod.mp4 --at 2:14:05 --len 35 --title "HE ROBBED THE WRONG GUY"

# ...or cut everything it found in one go
python3 clipper.py auto vod.mp4 --chat chat.json --top 10 --out clips/
```

### Layouts
| `--layout` | Use when |
|---|---|
| `blur` (default) | Gameplay is the story. The 16:9 frame sits in the middle over a blurred fill. |
| `facecam --facecam x,y,w,h` | The streamer's reaction is the story. The facecam goes on top and the gameplay below. Find x,y,w,h by pausing the VOD and measuring the webcam box in source pixels. Most streamers keep it fixed, so measure once per streamer. |
| `crop` | The action is dead centre, for example first-person driving. |

Every clip comes out as 1080×1920 at 30 fps, H.264, with loudness normalised to −14 LUFS
(the level TikTok and Shorts target). Captions are burned in when faster-whisper is installed.
Set `WHISPER_MODEL=medium` for better accuracy or `base` for speed.

## How the money works

1. **Clipping programs.** Many big streamers, and agencies working for them, pay clippers per
   1,000 views on clips posted to the clipper's own accounts. They list these campaigns on
   creator-reward marketplaces and in the streamer's Discord. Rates and rules vary by campaign,
   so read them before you post. This is the fastest way to get paid, and it gives you permission.
2. **Your own channels.** Grow a GTA VI clip channel and earn from Shorts and TikTok creator
   programs. Only post creators who allow clipping. Unlicensed reposts get copyright strikes,
   and strikes kill channels.
3. **Direct deals.** Once you have numbers, pitch a mid-size streamer: "I'll run your Shorts
   channel for $X/month or a revenue share."

## GTA VI launch plan

GTA VI comes out on **19 Nov 2026**.

- **Before launch:** sign up for 3–5 clipping campaigns from GTA streamers. Make 1–2 fresh
  accounts per platform and warm them up with a few posts. Measure each streamer's facecam box.
  Do a test run of this pipeline on an old VOD.
- **Launch day and week 1:** speed beats polish. The first clips of a moment get the views.
  Clip live: when chat explodes, note the time and cut it as soon as the VOD is available.
  Aim for 5–15 posts a day across your accounts.
- **What goes viral in GTA:** first reactions to the map and graphics, police chases that go
  wrong, glitches and physics fails, RP drama on the big RP servers once they launch, and
  streamer-vs-streamer moments.

### A clip that performs
- **The first second is the hook.** Start right before the payoff, not at the build-up.
  Burn a title on with `--title`.
- **20–40 seconds** is the sweet spot. Shorter is better if the payoff lands.
- **Captions on.** Most people watch with the sound off.
- **Name the streamer** in the caption, plus the game name and 3–5 tags.
- **Post when their audience is online**, usually right after the stream ends.
