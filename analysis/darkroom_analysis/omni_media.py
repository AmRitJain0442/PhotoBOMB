"""Video generation via gemini-omni-flash-preview (spec 2026-07-16 §7).

generate_video() drives ONE Interactions API call (image_to_video for hero
clips, reference_to_video for the AI film), downloads the result to out_path,
and returns its duration in ms. mp4_duration_ms() is a tiny pure mvhd parser
so we need no media toolchain to measure what came back.
"""

import mimetypes
from pathlib import Path

MODEL = "gemini-omni-flash-preview"
PROJECT = "project-a2dcdad0-5d65-4d61-846"
POLL_SECONDS = 5
POLL_LIMIT = 120  # up to 10 minutes for a video


def make_client():
    from google import genai

    return genai.Client(vertexai=True, project=PROJECT, location="global")


def mp4_duration_ms(path):
    """Duration from the moov/mvhd box, or None when unparseable."""
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None

    def boxes(buf, start, end):
        pos = start
        while pos + 8 <= end:
            size = int.from_bytes(buf[pos : pos + 4], "big")
            kind = buf[pos + 4 : pos + 8]
            if size < 8 or pos + size > end:
                return
            yield kind, pos + 8, pos + size
            pos += size

    for kind, body_start, body_end in boxes(data, 0, len(data)):
        if kind != b"moov":
            continue
        for inner, istart, iend in boxes(data, body_start, body_end):
            if inner != b"mvhd" or iend - istart < 20:
                continue
            version = data[istart]
            if version == 1:
                timescale = int.from_bytes(data[istart + 20 : istart + 24], "big")
                duration = int.from_bytes(data[istart + 24 : istart + 32], "big")
            else:
                timescale = int.from_bytes(data[istart + 12 : istart + 16], "big")
                duration = int.from_bytes(data[istart + 16 : istart + 20], "big")
            if timescale <= 0:
                return None
            return round(duration * 1000 / timescale)
    return None


def _video_content(interaction):
    """The video content item of a completed interaction, or None."""
    for step in getattr(interaction, "steps", None) or []:
        if getattr(step, "type", "") != "model_output":
            continue
        for item in getattr(step, "content", None) or []:
            if getattr(item, "type", "") == "video":
                return item
    return None


def _write_video(item, out_path):
    """Write a video content item (inline base64/bytes or hosted URI)."""
    import base64

    data = getattr(item, "data", None)
    if isinstance(data, str) and data:
        Path(out_path).write_bytes(base64.b64decode(data))
        return True
    if isinstance(data, (bytes, bytearray)) and data:
        Path(out_path).write_bytes(data)
        return True
    uri = getattr(item, "uri", None) or getattr(item, "url", None)
    if uri:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        resp = AuthorizedSession(creds).get(uri, timeout=300)
        resp.raise_for_status()
        Path(out_path).write_bytes(resp.content)
        return True
    return False


def generate_video(client, *, task, prompt, image_paths, out_path, aspect="9:16"):
    """One omni interaction -> mp4 at out_path, returns duration_ms or None.

    Live contract (probed 2026-07-16, SDK 2.11.0 / Vertex global): input is a
    bare list of content items; the task (image_to_video vs reference) is
    inferred from the inputs; the video comes back base64 in a model_output
    step. `task` is kept for callers/logging only.
    """
    import base64
    import time

    content = [{"type": "text", "text": prompt}]
    for p in image_paths:
        mime = mimetypes.guess_type(p)[0] or "image/jpeg"
        content.append(
            {
                "type": "image",
                "data": base64.b64encode(Path(p).read_bytes()).decode("ascii"),
                "mime_type": mime,
            }
        )

    interaction = client.interactions.create(
        model=MODEL,
        input=content,
        response_format={"type": "video", "aspect_ratio": aspect},
        background=True,
    )

    for _ in range(POLL_LIMIT):
        status = str(getattr(interaction, "status", "")).lower()
        if status not in ("in_progress", "queued", "pending", ""):
            break
        time.sleep(POLL_SECONDS)
        interaction = client.interactions.get(id=interaction.id)

    if str(getattr(interaction, "status", "")).lower() != "completed":
        return None
    item = _video_content(interaction)
    if item is None:
        return None
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    if not _write_video(item, out_path):
        return None
    return mp4_duration_ms(out_path)
