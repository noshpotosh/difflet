"""Render the geometric extension mark without third-party image libraries."""

import struct
import zlib
from pathlib import Path

ICON_SIZE = 128
SUPERSAMPLE_SCALE = 4
ICON_PATH = Path('media/icon.png')
BACKGROUND_COLOR = (24, 31, 45, 255)
BRANCH_COLOR = (142, 164, 191, 255)
BRANCH_NODE_COLOR = (214, 225, 238, 255)
ADDITION_COLOR = (117, 222, 167, 255)
DELETION_COLOR = (247, 145, 153, 255)
BRANCH_NODE_CENTERS = ((27, 31), (27, 96), (48, 62))
BRANCH_NODE_RADIUS = 7
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PNG_BIT_DEPTH = 8
PNG_RGBA_COLOR_TYPE = 6


def create_icon():
    """Render antialiased RGBA scanlines and overwrite the extension's PNG icon."""
    scanlines = []

    for pixel_y in range(ICON_SIZE):
        # PNG filter type 0 leaves each scanline's bytes unchanged.
        row = bytearray([0])
        for pixel_x in range(ICON_SIZE):
            channel_totals = [0, 0, 0, 0]
            for sample_y in range(SUPERSAMPLE_SCALE):
                for sample_x in range(SUPERSAMPLE_SCALE):
                    x = pixel_x + (sample_x + 0.5) / SUPERSAMPLE_SCALE
                    y = pixel_y + (sample_y + 0.5) / SUPERSAMPLE_SCALE
                    color = sample_icon_color(x, y)
                    for channel_index, channel_value in enumerate(color):
                        channel_totals[channel_index] += channel_value

            row.extend(round(total / SUPERSAMPLE_SCALE**2) for total in channel_totals)
        scanlines.append(row)

    # Header fields after color type: standard compression, filtering, no interlace.
    header = struct.pack('>IIBBBBB', ICON_SIZE, ICON_SIZE, PNG_BIT_DEPTH, PNG_RGBA_COLOR_TYPE, 0, 0, 0)
    png_data = (
        PNG_SIGNATURE
        + encode_png_chunk(b'IHDR', header)
        + encode_png_chunk(b'IDAT', zlib.compress(b''.join(scanlines)))
        + encode_png_chunk(b'IEND', b'')
    )
    ICON_PATH.write_bytes(png_data)


def sample_icon_color(x, y):
    """Return the RGBA color at a subpixel position in the icon's coordinate space."""
    color = BACKGROUND_COLOR

    # Split additions/deletions card, with a Git branch spine.
    if (24 <= x <= 30 and 31 <= y <= 96) or (27 <= x <= 48 and 59 <= y <= 65):
        color = BRANCH_COLOR
    if any(
        (x - center_x)**2 + (y - center_y)**2 <= BRANCH_NODE_RADIUS**2
        for center_x, center_y in BRANCH_NODE_CENTERS
    ):
        color = BRANCH_NODE_COLOR

    if (69 <= x <= 104 and 37 <= y <= 43) or (83 <= x <= 89 and 23 <= y <= 57):
        color = ADDITION_COLOR
    if 69 <= x <= 104 and 84 <= y <= 90:
        color = DELETION_COLOR

    return color


def encode_png_chunk(kind, data):
    """Encode a four-byte PNG chunk type and payload with its length and CRC."""
    return (
        struct.pack('>I', len(data))
        + kind
        + data
        + struct.pack('>I', zlib.crc32(kind + data))
    )


if __name__ == '__main__':
    create_icon()
