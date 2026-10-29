# Installing KeyChange

A local audio studio for your Mac. Analyse a song's key and BPM, change its pitch
and speed independently, loop a section to the beat, and export — optionally
splitting a song into vocals and backing. Nothing is uploaded anywhere; the audio
never leaves the machine.

## Install

1. Unzip the download somewhere you intend to keep it — your home folder or
   Documents is ideal. **Not** Downloads, which gets tidied up.
2. Open the folder and double-click **Install KeyChange**.
3. macOS will probably say it is from an unidentified developer. That is
   expected for anything not sold through the App Store. **Right-click** the
   file instead, choose **Open**, then **Open** again in the dialog. You only
   have to do this once.
4. A Terminal window appears and does the work. It asks one question — whether
   to include stem separation — then runs to the end.

When it finishes, KeyChange is in your Applications folder. Open it from
Launchpad and drag it to your Dock.

### If you prefer the terminal

```
cd /path/to/KeyChange
./install.sh
```

## What it installs

The installer uses [Homebrew](https://brew.sh) to add anything missing. If you do
not have Homebrew it will tell you and stop, rather than installing it behind your
back.

| | |
|---|---|
| Node 20+ | runs the app itself |
| ffmpeg | decodes audio files |
| uv | sets up the Python side |

Then, in this folder: the app's JavaScript packages, a Python environment, and the
app bundle.

Measured on an Apple Silicon Mac:

| | on disk | |
|---|---|---|
| **With stem separation** | about 1.9 GB | downloads PyTorch; a few minutes |
| **Without** | about 0.9 GB | everything else still works |

Without separation you still get key and BPM detection, pitch, speed, looping, EQ,
reverb and export — only splitting a song into vocals and backing is missing. You
can add it later with:

```
cd services/worker && uv sync --extra stems
```

## Using it

Drop in an audio file — mp3, wav, m4a, mp4, flac, aiff. There is no size or length
limit, and exports keep the file's own sample rate rather than quietly downgrading it.

- **Space** plays and pauses; **←** and **→** jump five seconds.
- Scroll on the waveform to zoom, ⌘-drag to pan.
- **Shift-click** sets the loop start, **Alt-click** the end. Loop points snap to
  the detected beat, so a loop starts on a downbeat rather than near one.
- When a loop is set, Export offers that loop on its own or the whole track.

## If something goes wrong

**"KeyChange" can't be opened / is damaged.** This should not happen, because the
app is built on your machine rather than downloaded. If it does, right-click the
app and choose Open.

**The window opens but says the analysis worker is not running.** Give it a few
seconds — it starts alongside the app and takes a moment. Everything except key,
BPM and stems works meanwhile.

**It stopped working after I moved the folder.** The app runs the code in this
folder and has its location compiled in. Run `./install.sh` again from the new
place.

**Stopping it.** The app leaves two small servers running so that closing the
window cannot abandon a separation that is midway through. To stop them:

```
./desktop/stop.sh
```

Logs are in `~/Library/Logs/KeyChange/`.

## Requirements

macOS 12 or newer, Apple Silicon or Intel. Stem separation uses the GPU on Apple
Silicon and falls back to the CPU elsewhere, where it is considerably slower.
