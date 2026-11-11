from io import BytesIO
import logging
import warnings

import pytesseract
from PIL import Image, ImageOps

from core import parse_receipt

log = logging.getLogger(__name__)


def light_document_region(image):
    """Find a large light receipt inside a dark messenger screenshot."""
    bright = image.point(lambda pixel: 255 if pixel >= 235 else 0)

    def largest_run(values, minimum, gap):
        runs = []
        start = end = None
        for index, value in enumerate(values):
            if value >= 50:
                if start is None:
                    start = index
                end = index + 1
            elif start is not None and index - end > gap:
                runs.append((start, end))
                start = end = None
        if start is not None:
            runs.append((start, end))
        return max((run for run in runs if run[1] - run[0] >= minimum),
                   key=lambda run: run[1] - run[0], default=None)

    columns = bright.resize((image.width, 1), Image.Resampling.BOX).getdata()
    horizontal = largest_run(columns, image.width // 4, max(3, image.width // 200))
    if horizontal is None:
        return image
    left, right = horizontal
    strip = bright.crop((left, 0, right, image.height))
    rows = strip.resize((1, image.height), Image.Resampling.BOX).getdata()
    vertical = largest_run(rows, image.height // 3, max(4, image.height // 150))
    if vertical is None:
        return image
    top, bottom = vertical
    return image.crop((left, top, right, bottom))


def recognize(data, update_id=None):
    # Bounds apply before decoding and upscaling, including compressed image bombs.
    Image.MAX_IMAGE_PIXELS = 12_000_000
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(BytesIO(data)) as source:
            if source.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('Пришлите PNG, JPEG или WebP.')
            log.info('OCR image opened: update_id=%s format=%s width=%s height=%s',
                     update_id, source.format, source.width, source.height)
            source.load()
            original = ImageOps.grayscale(ImageOps.exif_transpose(source))
    image = original
    scale = min(2, 2400 / max(image.size))
    image = image.resize((int(image.width * scale), int(image.height * scale)))
    image = ImageOps.autocontrast(image)
    candidates = set()
    def read_variant(variant, mode, name):
        text = pytesseract.image_to_string(variant, lang='rus+eng', config=f'--psm {mode}', timeout=30)
        try:
            candidates.add(parse_receipt(text))
        except ValueError as error:
            log.info('OCR variant rejected: update_id=%s variant=%s psm=%s reason=%s',
                     update_id, name, mode, error)
        else:
            log.info('OCR variant accepted: update_id=%s variant=%s psm=%s', update_id, name, mode)

    for mode in (6, 3):
        read_variant(image, mode, 'full')
    if not candidates:
        # Pale grey date lines can disappear during Tesseract's own binarization.
        # Try two contrast thresholds; disagreement still rejects the receipt.
        for threshold in (180, 210):
            read_variant(image.point(lambda pixel: 255 if pixel > threshold else 0), 6,
                         f'threshold_{threshold}')
    if not candidates:
        # A receipt forwarded as a narrow phone screenshot needs more pixels per
        # character. Crop the light document before enlarging to keep OCR bounded.
        panel = ImageOps.autocontrast(light_document_region(original))
        log.info('OCR cropped region: update_id=%s width=%s height=%s',
                 update_id, panel.width, panel.height)
        scale = min(4, 4000 / max(panel.size))
        if scale > 1:
            panel = panel.resize((int(panel.width * scale), int(panel.height * scale)))
        for mode in (6, 3):
            read_variant(panel, mode, 'cropped')
    if len(candidates) != 1:
        log.info('OCR result rejected: update_id=%s candidate_count=%s', update_id, len(candidates))
        raise ValueError('Не удалось уверенно прочитать квитанцию. Пришлите полный чёткий скриншот без обрезки.')
    log.info('OCR result accepted: update_id=%s', update_id)
    return candidates.pop()
