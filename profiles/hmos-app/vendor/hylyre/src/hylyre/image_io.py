"""Validated PNG/JPEG transport and failure-safe screenshot publication."""

from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

# Pillow reports a JPEG that carries an MPF (multi-picture) segment as "MPO".
_FORMATS = {"PNG": "PNG", "JPEG": "JPEG", "MPO": "JPEG"}

# Temp files are created 0600 on POSIX; publish with the mode write_bytes would
# have used. ponytail: umask read once at import, later os.umask() calls ignored.
_UMASK = os.umask(0)
os.umask(_UMASK)


def image_format(out: Path | str) -> str:
    """Resolve a supported target suffix without changing the requested path."""
    suffix = Path(out).suffix.lower()
    if suffix == ".png":
        return "PNG"
    if suffix in (".jpg", ".jpeg"):
        return "JPEG"
    raise ValueError("Screenshot output must use .png, .jpg or .jpeg")


def _decoded_image(raw: bytes):
    # Lazy import lets CLI and diagnostic callers keep their existing errors.
    from PIL import Image

    image = None
    try:
        with Image.open(BytesIO(raw)) as probe:
            source_format = probe.format
            if source_format not in _FORMATS:
                raise ValueError("unsupported image format: " + str(source_format))
            probe.verify()
        image = Image.open(BytesIO(raw))
        if image.format != source_format:
            raise ValueError("Screenshot format changed while decoding")
        image.load()
    except Exception as error:
        if image is not None:
            image.close()
        if isinstance(error, ImportError):
            raise
        raise ValueError(f"Screenshot is not a valid PNG/JPEG image: {error}") from error
    return image


def image_mime(raw: bytes) -> str:
    """Return the actual MIME only after structural and full decode checks."""
    with _decoded_image(raw) as image:
        return "image/jpeg" if _FORMATS[image.format] == "JPEG" else "image/png"


def write_image(raw: bytes, out: Path | str) -> str:
    """Publish the requested encoding atomically, preserving old data on failure."""
    from PIL import Image

    out = Path(out)
    target_format = image_format(out)
    temporary = None
    try:
        with _decoded_image(raw) as image:
            out.parent.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=out.parent, prefix=f".{out.name}.", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                if _FORMATS[image.format] == target_format:
                    stream.write(raw)
                elif target_format == "JPEG":
                    if image.mode.startswith("I"):
                        # PNG integer grayscale uses the fixed unsigned 16-bit range.
                        rgba = image.point(lambda value: value * (255 / 65535)).convert("L").convert("RGBA")
                    else:
                        rgba = image.convert("RGBA")
                    background = Image.new("RGBA", image.size, "white")
                    background.alpha_composite(rgba)
                    background.convert("RGB").save(stream, format="JPEG", quality=95)
                else:
                    if image.mode == "CMYK":
                        image.convert("RGB").save(stream, format="PNG")
                    else:
                        image.save(stream, format="PNG")
            os.chmod(temporary, 0o666 & ~_UMASK)
            os.replace(temporary, out)
        return str(out.resolve())
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
