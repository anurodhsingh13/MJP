import { useSyncExternalStore } from 'react';
import { UserRound } from 'lucide-react';
import { readAvatar, subscribeAvatar } from './avatarStore';

/** Round profile picture: the user's own photo when they set one, otherwise a neutral user icon. */
export function Avatar({ accountId, size = 36, className = '', label = '' }: { accountId: string; size?: number; className?: string; label?: string }) {
  const src = useSyncExternalStore(subscribeAvatar, () => readAvatar(accountId), () => readAvatar(accountId));
  if (!src) return <span className={`ts-avatar ts-avatar-default ${className}`} role={label ? 'img' : undefined} aria-label={label || undefined} style={{ width: size, height: size }}><UserRound size={Math.round(size * 0.5)} aria-hidden="true" /></span>;
  return <img className={`ts-avatar ${className}`} src={src} width={size} height={size} alt={label} style={{ width: size, height: size }} />;
}
