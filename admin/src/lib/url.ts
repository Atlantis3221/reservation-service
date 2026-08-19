/** Базовый адрес клиентских страниц: admin.slotik.tech → slotik.tech */
export function getScheduleBaseUrl(): string {
  const env = import.meta.env.VITE_FRONTEND_URL;
  if (env) return env.replace(/\/+$/, '');

  const { protocol, hostname, port } = window.location;
  const host = hostname.startsWith('admin.') ? hostname.replace('admin.', '') : hostname;
  const suffix = port && port !== '80' && port !== '443' ? `:${port}` : '';
  return `${protocol}//${host}${suffix}`;
}

export function getPublicUrl(slug: string): string {
  return `${getScheduleBaseUrl()}/${slug}`;
}
