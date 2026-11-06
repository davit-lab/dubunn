import { getEmbedUrl, isVideoFile } from '@/lib/media';

export function VideoPlayer({ src, poster, className = '', onEnded }: { src: string; poster?: string; className?: string; onEnded?: () => void }) {
  if (!src) return null;
  const embed = getEmbedUrl(src);
  if (embed) {
    return (
      <iframe
        src={embed}
        title="Video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className={`w-full h-full border-0 ${className}`}
      />
    );
  }
  if (isVideoFile(src) || src.startsWith('blob:') || src.startsWith('data:')) {
    return <video src={src} controls playsInline poster={poster} onEnded={onEnded} className={`w-full h-full object-cover ${className}`} />;
  }
  // Fallback: try as video, but most likely an unsupported link.
  return <video src={src} controls playsInline poster={poster} onEnded={onEnded} className={`w-full h-full object-cover ${className}`} />;
}
