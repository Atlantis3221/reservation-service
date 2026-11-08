from io import BytesIO
import warnings

import pytesseract
from PIL import Image, ImageOps

from core import parse_receipt


def recognize(data):
    # Bounds apply before decoding and upscaling, including compressed image bombs.
    Image.MAX_IMAGE_PIXELS = 12_000_000
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(BytesIO(data)) as source:
            if source.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('Пришлите PNG, JPEG или WebP.')
            source.load()
            image = ImageOps.grayscale(ImageOps.exif_transpose(source))
    scale = min(2, 2400 / max(image.size))
    image = image.resize((int(image.width * scale), int(image.height * scale)))
    image = ImageOps.autocontrast(image)
    candidates = set()
    def read_variant(variant, mode):
        text = pytesseract.image_to_string(variant, lang='rus+eng', config=f'--psm {mode}', timeout=30)
        try:
            candidates.add(parse_receipt(text))
        except ValueError:
            pass

    for mode in (6, 3):
        read_variant(image, mode)
    if not candidates:
        # Pale grey date lines can disappear during Tesseract's own binarization.
        # Try two contrast thresholds; disagreement still rejects the receipt.
        for threshold in (180, 210):
            read_variant(image.point(lambda pixel: 255 if pixel > threshold else 0), 6)
    if len(candidates) != 1:
        raise ValueError('Не удалось уверенно прочитать квитанцию. Пришлите полный чёткий скриншот без обрезки.')
    return candidates.pop()
