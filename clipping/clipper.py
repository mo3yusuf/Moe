#!/usr/bin/env python3
"""
clipper.py - turn long stream VODs into short vertical clips.

  find  VOD            score the VOD and list the best moments
  cut   VOD --at T     cut one vertical (9:16) clip around time T
  auto  VOD            find the best moments and cut all of them

Highlights are scored from two signals:
  * audio  - sudden loudness spikes (screaming, laughing, explosions)
  * chat   - bursts of chat messages and hype words (KEKW, W, "CLIP IT")
             when you pass --chat (a TwitchDownloader JSON export, or a JSON
             list of {"t": seconds, "text": "..."})

Needs: ffmpeg, python3, numpy.  Optional: faster-whisper, for burned-in captions.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile
import numpy as np

SR = 8000          # audio sample rate used for analysis (low = fast)
HYPE = re.compile(r"\b(kekw|lul|lmao+|omegalul|w+|pog\w*|clip\s*it|clip that|"
                   r"no way|holy|wtf|bro+|insane|monka\w*|sheesh|lets go+)\b", re.I)


# ---------- helpers ----------------------------------------------------------
def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode:
        sys.exit("command failed: " + " ".join(cmd) + "\n" + r.stderr.decode()[-2000:])
    return r.stdout

def ts(sec):
    sec = int(round(sec)); return f"{sec//3600}:{sec//60%60:02d}:{sec%60:02d}"

def parse_ts(s):
    sec = 0.0
    for part in str(s).split(":"): sec = sec * 60 + float(part)
    return sec

def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", path])
    return float(out)

def zscore(x, floor=1.0):
    """Robust z-score against a rolling 2-minute baseline, so a loud
    streamer is compared to their own normal, not to silence."""
    if len(x) == 0: return x
    k = min(len(x), 121)
    pad = np.pad(x, (k // 2, k // 2), mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(pad, k)[: len(x)]
    med = np.median(win, axis=1)
    mad = np.maximum(np.median(np.abs(win - med[:, None]), axis=1), floor)
    return (x - med) / (1.4826 * mad)


# ---------- scoring ----------------------------------------------------------
def audio_curve(vod):
    """Loudness (dB) per second of the VOD."""
    raw = run(["ffmpeg", "-v", "error", "-i", vod, "-vn", "-ac", "1", "-ar", str(SR),
               "-f", "s16le", "-"])
    a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = len(a) // SR
    rms = np.sqrt((a[: n * SR].reshape(n, SR) ** 2).mean(axis=1) + 1e-10)
    return 20 * np.log10(rms)

def load_chat(path):
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict) and "comments" in data:          # TwitchDownloader
        return [(c["content_offset_seconds"], c.get("message", {}).get("body", ""))
                for c in data["comments"]]
    return [(float(m["t"]), m.get("text", "")) for m in data]  # generic

def chat_curve(chat, n):
    rate, hype = np.zeros(n), np.zeros(n)
    for t, text in chat:
        i = int(t)
        if 0 <= i < n:
            rate[i] += 1
            hype[i] += len(HYPE.findall(text or ""))
    # smooth over 5s: chat reacts a few seconds after the moment
    k = np.ones(5)
    return np.convolve(rate, k, "same"), np.convolve(hype, k, "same")

def find_moments(vod, chat_path=None, top=10, clip_len=30, min_gap=None):
    loud = audio_curve(vod)
    n = len(loud)
    score = np.clip(zscore(np.convolve(loud, np.ones(3) / 3, "same")), 0, None)
    if chat_path:
        rate, hype = chat_curve(load_chat(chat_path), n)
        # chat lags the moment by ~3-6s; shift it back so it lines up
        lag = 4
        rate = np.concatenate([rate[lag:], np.zeros(lag)])
        hype = np.concatenate([hype[lag:], np.zeros(lag)])
        score = 0.5 * score + 1.0 * np.clip(zscore(rate), 0, None) + 1.5 * np.clip(zscore(hype), 0, None)
    # pick peaks, keeping them at least min_gap seconds apart
    min_gap = min_gap or clip_len * 2
    order, picked = np.argsort(-score), []
    for i in order:
        if score[i] < 3 or len(picked) >= top: break   # 3 = clearly above normal
        if all(abs(i - p) >= min_gap for p in picked): picked.append(int(i))
    moments = []
    for p in sorted(picked):
        # the payoff is usually at the peak: give ~70% of the clip as build-up
        start = max(0, p - clip_len * 0.7)
        moments.append({"peak": p, "start": round(start, 1),
                        "end": round(min(n, start + clip_len), 1),
                        "score": round(float(score[p]), 2), "at": ts(p)})
    return sorted(moments, key=lambda m: -m["score"])


# ---------- captions ---------------------------------------------------------
def make_captions(clip_wav, ass_path, words_per_line=3):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return False
    model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), compute_type="int8")
    segs, _ = model.transcribe(clip_wav, word_timestamps=True, vad_filter=True)
    words = [w for s in segs for w in (s.words or [])]
    if not words: return False
    def t(x): return f"{int(x//3600)}:{int(x//60%60):02d}:{x%60:05.2f}"
    lines = []
    for i in range(0, len(words), words_per_line):
        chunk = words[i:i + words_per_line]
        text = " ".join(w.word.strip() for w in chunk).upper().replace("{", "").replace("}", "")
        lines.append(f"Dialogue: 0,{t(chunk[0].start)},{t(chunk[-1].end + 0.05)},Cap,,0,0,0,,{text}")
    open(ass_path, "w").write(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,"
        "Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV\n"
        "Style: Cap,Arial Black,92,&H00FFFFFF,&H00000000,&H80000000,1,1,7,2,2,60,60,560\n\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
        + "\n".join(lines) + "\n")
    return True


# ---------- cutting ----------------------------------------------------------
def cut(vod, start, length, out, layout="blur", facecam=None, captions=True, title=None):
    """Cut [start, start+length] and render it as 1080x1920.

    layout=blur     gameplay centred, blurred copy filling the background
    layout=facecam  facecam crop on top (1/3), gameplay on the bottom (2/3)
                    facecam = "x,y,w,h" in source pixels
    layout=crop     plain centre crop (good when the action is centred)
    """
    if layout == "facecam":
        if not facecam: sys.exit("--facecam x,y,w,h is required for the facecam layout")
        x, y, w, h = facecam.split(",")
        vf = (f"[0:v]split[a][b];"
              f"[a]crop={w}:{h}:{x}:{y},scale=1080:640:force_original_aspect_ratio=increase,crop=1080:640[cam];"
              f"[b]scale=-2:1280,crop=1080:1280[game];"
              f"[cam][game]vstack[v]")
    elif layout == "crop":
        vf = "[0:v]scale=-2:1920,crop=1080:1920[v]"
    else:
        vf = ("[0:v]split[a][b];"
              "[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,eq=brightness=-0.15,scale=1080:1920[bg];"
              "[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]")
    tmp = tempfile.mkdtemp()
    try:
        if captions:
            wav = os.path.join(tmp, "a.wav")
            run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", vod,
                 "-vn", "-ac", "1", "-ar", "16000", wav])
            ass = os.path.join(tmp, "c.ass")
            if make_captions(wav, ass):
                vf = vf[: -len("[v]")] + "[pre];[pre]ass=" + ass.replace(":", r"\:") + "[v]"
        if title:
            safe = title.replace("'", "").replace(":", r"\:")
            vf = vf[: -len("[v]")] + ("[t0];[t0]drawtext=text='" + safe + "':fontsize=72:fontcolor=white:"
                  "borderw=6:bordercolor=black:x=(w-text_w)/2:y=160[v]")
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", vod,
             "-filter_complex", vf, "-map", "[v]", "-map", "0:a?",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-r", "30", "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-14:TP=-1.5",
             "-movflags", "+faststart", out])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ---------- CLI ---------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("find", "cut", "auto"):
        p = sub.add_parser(name)
        p.add_argument("vod")
        p.add_argument("--len", type=float, default=30, help="clip length in seconds (default 30)")
        if name != "cut":
            p.add_argument("--chat", help="chat log JSON (TwitchDownloader export or [{t,text}])")
            p.add_argument("--top", type=int, default=10, help="how many moments (default 10)")
        if name != "find":
            p.add_argument("--layout", choices=["blur", "facecam", "crop"], default="blur")
            p.add_argument("--facecam", help="x,y,w,h of the facecam in the source video")
            p.add_argument("--no-captions", action="store_true")
            p.add_argument("--out", default="clips")
        if name == "cut":
            p.add_argument("--at", required=True, help="start time, e.g. 1:23:45")
            p.add_argument("--title", help="text hook burned in at the top")
    a = ap.parse_args()

    if a.cmd == "cut":
        os.makedirs(a.out, exist_ok=True)
        start = parse_ts(a.at)
        out = os.path.join(a.out, f"clip_{ts(start).replace(':', '-')}.mp4")
        print(cut(a.vod, start, a.len, out, a.layout, a.facecam, not a.no_captions, a.title))
        return

    moments = find_moments(a.vod, a.chat, a.top, a.len)
    print(f"{'#':>2}  {'peak':>8}  {'score':>6}   cut from")
    for i, m in enumerate(moments, 1):
        print(f"{i:>2}  {m['at']:>8}  {m['score']:>6}   {ts(m['start'])} - {ts(m['end'])}")
    if a.cmd == "find":
        json.dump(moments, open("highlights.json", "w"), indent=2)
        print("saved highlights.json")
        return
    os.makedirs(a.out, exist_ok=True)
    for i, m in enumerate(moments, 1):
        out = os.path.join(a.out, f"{i:02d}_{m['at'].replace(':', '-')}_score{m['score']}.mp4")
        cut(a.vod, m["start"], m["end"] - m["start"], out, a.layout, a.facecam, not a.no_captions)
        print("  wrote", out)

if __name__ == "__main__":
    main()
