"""Minimal EXIF extraction: timestamp + GPS, both optional."""

from PIL import ExifTags, Image

_DATETIME_ORIGINAL = 36867  # DateTimeOriginal
_GPS_IFD = 34853


def _to_iso(dt: str):
    # EXIF format: "YYYY:MM:DD HH:MM:SS"
    try:
        date, time = dt.split(" ")
        return f"{date.replace(':', '-')}T{time}"
    except (ValueError, AttributeError):
        return None


def _to_deg(values, ref):
    try:
        d, m, s = (float(v) for v in values)
        deg = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            deg = -deg
        return round(deg, 6)
    except (TypeError, ValueError):
        return None


def read(path: str) -> dict:
    ts = None
    gps = None
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            raw_ts = exif.get_ifd(ExifTags.IFD.Exif).get(_DATETIME_ORIGINAL) or exif.get(306)
            ts = _to_iso(raw_ts) if raw_ts else None
            gps_ifd = exif.get_ifd(_GPS_IFD)
            if gps_ifd:
                lat = _to_deg(gps_ifd.get(2), gps_ifd.get(1))
                lon = _to_deg(gps_ifd.get(4), gps_ifd.get(3))
                if lat is not None and lon is not None:
                    gps = [lat, lon]
    except OSError:
        pass
    return {"ts": ts, "gps": gps}
