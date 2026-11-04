// Shared by the service worker, which fetches Chat images, and the panel, which encodes blob: images.
// A content script cannot read Chat attachments: they redirect to another origin without CORS headers.
((root, factory) => {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.__A2GENT_CHAT_ASSIST_IMAGE__ = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CHAT_HOSTS = ['chat.google.com', 'mail.google.com'];
  const IMAGE_HOSTS = [...CHAT_HOSTS, 'lh3.google.com'];
  const IMAGE_HOST_SUFFIX = '.googleusercontent.com';
  const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
  // Larger sides are downscaled by vision models anyway, and eight full-size images would not fit
  // the 64 MiB extension message limit.
  const MAX_SIDE = 1568;
  const JPEG_QUALITY = 0.85;
  const BASE64_CHUNK = 0x8000;
  const FETCH_TIMEOUT_MS = 30 * 1000;

  const httpsHost = (raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.hostname : '';
    } catch {
      return '';
    }
  };

  const isChatPage = (raw) => CHAT_HOSTS.includes(httpsHost(raw));

  const isChatImageUrl = (raw) => {
    const host = httpsHost(raw);
    return IMAGE_HOSTS.includes(host) || host.endsWith(IMAGE_HOST_SUFFIX);
  };

  const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
    }
    return btoa(binary);
  };

  const encodeImage = async (blob) => {
    if (blob.size > MAX_SOURCE_BYTES) throw new Error('Image is too large.');
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    // JPEG has no alpha channel, and transparent pixels would turn black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return { media_type: 'image/jpeg', data_base64: toBase64(await jpeg.arrayBuffer()) };
  };

  const fetchChatImage = async (url) => {
    if (!isChatImageUrl(url)) throw new Error(`Image host is not allowed: ${httpsHost(url) || 'unknown'}`);
    const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status}`);
    if (!isChatImageUrl(response.url)) throw new Error(`Image redirected to a host that is not allowed: ${httpsHost(response.url) || 'unknown'}`);
    if (Number(response.headers?.get('content-length')) > MAX_SOURCE_BYTES) throw new Error('Image is too large.');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`Not an image: ${blob.type || 'unknown type'}`);
    return encodeImage(blob);
  };

  return { isChatPage, isChatImageUrl, encodeImage, fetchChatImage };
});
