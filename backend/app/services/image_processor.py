import logging
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)


def remove_background(input_path: str, output_path: str, progress_callback: Optional[Callable[[int], None]] = None) -> str:
    """Remove background from image using rembg.
    Always saves as PNG to support RGBA transparency.

    Args:
        input_path: Path to input image
        output_path: Path to save output image
        progress_callback: Optional callback function to report progress (0-100)

    Returns:
        Path to the processed image
    """
    from rembg import remove
    from PIL import Image

    logger.info(f"Removing background: {input_path}")

    # Report loading model (0-25%)
    if progress_callback:
        progress_callback(0)

    inp = Image.open(input_path)

    if progress_callback:
        progress_callback(25)

    # Report processing (25-75%)
    out = remove(inp)

    if progress_callback:
        progress_callback(75)

    # Always save as PNG (supports RGBA)
    png_path = str(Path(output_path).with_suffix(".png"))
    out.save(png_path)

    # Report completion (100%)
    if progress_callback:
        progress_callback(100)

    logger.info(f"Background removed: {png_path}")
    return png_path
