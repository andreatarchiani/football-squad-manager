/** Reads an image file and returns a small square data URL (cover crop) for logos. */
export function prepareIconImage(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Invalid image'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('Canvas unavailable')); return; }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale, height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL('image/webp', 0.8));
      };
      image.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}
