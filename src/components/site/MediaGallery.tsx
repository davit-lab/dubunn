import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';

type MediaItem = { type: 'image' | 'video'; src: string };

type MediaGalleryProps = {
  name: string;
  image?: string;
  gallery?: string[];
  video?: string;
  galleryVideos?: string[];
  accentClass?: string;
  aspectClass?: string;
};

export function MediaGallery({
  name,
  image,
  gallery,
  video,
  galleryVideos,
  accentClass = 'border-primary',
  aspectClass = 'aspect-[4/5]',
}: MediaGalleryProps) {
  const media = useMemo<MediaItem[]>(() => {
    const images = (gallery?.length ? gallery : [image]).filter(Boolean).map((src) => ({
      type: 'image' as const,
      src: src as string,
    }));
    const videos = [...(galleryVideos || []), ...(video && !(galleryVideos || []).includes(video) ? [video] : [])]
      .filter(Boolean)
      .map((src) => ({ type: 'video' as const, src }));
    return [...images, ...videos];
  }, [gallery, galleryVideos, image, video]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [media.length]);

  useEffect(() => {
    if (media.length < 2 || media[active]?.type === 'video') return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % media.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, media]);

  if (!media.length) return null;
  const current = media[active] || media[0];
  const next = () => setActive((currentIndex) => (currentIndex + 1) % media.length);
  const previous = () => setActive((currentIndex) => (currentIndex - 1 + media.length) % media.length);

  return (
    <div className="flex flex-col gap-3">
      <div className={`relative ${aspectClass} overflow-hidden rounded-[32px] bg-card border border-border shadow-glow group`}>
        <motion.div
          key={`${current.type}-${current.src}`}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full h-full"
        >
          {current.type === 'video' ? (
            <VideoPlayer src={current.src} poster={image} onEnded={next} />
          ) : (
            <img src={current.src} alt={name} className="w-full h-full object-cover" />
          )}
        </motion.div>

        {media.length > 1 && (
          <>
            <button type="button" onClick={previous} aria-label="Previous media" className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-ink border-2 border-ink shadow-sticker flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={next} aria-label="Next media" className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-ink border-2 border-ink shadow-sticker flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight size={18} />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-ink/80 text-white px-3 py-1 text-xs font-bold">
              {active + 1} / {media.length}
            </span>
          </>
        )}
      </div>

      {media.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {media.map((item, index) => (
            <button
              key={`${item.type}-${item.src}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`${item.type === 'video' ? 'Video' : 'Image'} ${index + 1}`}
              className={`relative w-20 h-20 rounded-2xl overflow-hidden border-2 flex-shrink-0 transition-all ${active === index ? accentClass : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              {item.type === 'video' ? (
                <>
                  <video src={item.src} className="w-full h-full object-cover" muted preload="metadata" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Play size={18} className="text-white fill-white" />
                  </span>
                </>
              ) : (
                <img src={item.src} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
