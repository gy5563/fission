export function downloadBlob(filename: string, blob: Blob, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(
  filename: string,
  text: string,
  mime: string,
  doc: Document = document,
): void {
  downloadBlob(filename, new Blob([text], { type: mime }), doc);
}
