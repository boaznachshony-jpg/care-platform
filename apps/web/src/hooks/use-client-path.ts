import { useParams } from 'react-router-dom';

export function clientPath(clientId: string, path = '/'): string {
  if (!clientId) return path;
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `/clients/${encodeURIComponent(clientId)}${suffix}`;
}

export function useClientPath(): (path?: string) => string {
  const { clientId = '' } = useParams<{ clientId: string }>();
  return (path = '/') => {
    if (clientId) return clientPath(clientId, path);
    return path === '/' ? '/app' : path;
  };
}
