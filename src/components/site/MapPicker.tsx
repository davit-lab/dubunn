import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, Search } from 'lucide-react';
import { useLangStore } from '@/store/langStore';

const MapInner = lazy(() => import('./MapPickerInner'));
interface Place { label: string; lat: number; lng: number; }
const cache = new Map<string, Place[]>();

interface Props {
  lat: number | null;
  lng: number | null;
  centerLat: number;
  centerLng: number;
  city?: string;
  onChange: (lat: number, lng: number) => void;
  onSelectAddress?: (address: string) => void;
}

export function MapPicker(props: Props) {
  const { lang } = useLangStore();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const previous = request.current; request.current = null; previous?.abort();
    setQuery(''); setResults([]); setMessage(''); setLoading(false);
    return () => { const pending = request.current; request.current = null; pending?.abort(); };
  }, [props.centerLat, props.centerLng, lang]);

  const search = async () => {
    if (query.trim().length < 3 || loading) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const params = new URLSearchParams({
      q: `${query.trim()}, ${props.city || ''}, Georgia`,
      lat: String(props.centerLat), lon: String(props.centerLng), limit: '5',
      bbox: '39.9,40.9,46.8,43.8',
      ...(lang === 'en' ? { lang: 'en' } : {}),
    });
    const key = params.toString();
    setLoading(true); setResults([]); setMessage('');
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      let places = cache.get(key);
      if (!places) {
        const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Search unavailable');
        const data = await response.json();
        places = (data.features || []).flatMap((feature: any) => {
          const [lng, lat] = feature.geometry?.coordinates || [];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
          const p = feature.properties || {};
          const label = [...new Set([p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.city, p.state].filter(Boolean))].join(', ');
          return label ? [{ label, lat, lng }] : [];
        });
        if (cache.size >= 50) cache.clear();
        cache.set(key, places!);
      }
      if (controller.signal.aborted) return;
      setResults(places!);
      if (!places!.length) setMessage(lang === 'ka' ? 'მისამართი ვერ მოიძებნა. სცადეთ სხვა ქუჩა ან მონიშნეთ რუკაზე.' : 'No addresses found. Try another street or click the map.');
    } catch {
      if (request.current === controller) setMessage(lang === 'ka' ? 'ძიება ვერ მოხერხდა. სცადეთ ხელახლა ან მონიშნეთ რუკაზე.' : 'Search unavailable. Try again or click the map.');
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  };

  const placeholder = <div className="aspect-[16/10] w-full rounded-2xl border-[3px] border-ink bg-cream flex items-center justify-center"><Loader2 className="animate-spin text-ink/40" /></div>;
  if (!mounted) return placeholder;
  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex gap-2" role="search" aria-label={lang === 'ka' ? 'ქუჩის ძიება' : 'Street search'}>
        <input aria-label={lang === 'ka' ? 'ქუჩა ან მისამართი' : 'Street or address'} placeholder={lang === 'ka' ? 'მოძებნეთ ქუჩა ან მისამართი' : 'Search for a street or address'}
          value={query} onChange={event => { request.current?.abort(); request.current = null; setLoading(false); setQuery(event.target.value); setResults([]); setMessage(''); }}
          className="min-w-0 flex-1 px-3 py-3 rounded-xl border-2 border-ink/20 bg-white font-semibold text-sm focus:outline-none focus:border-primary" />
        <button type="submit" disabled={loading || query.trim().length < 3} className="px-4 rounded-xl bg-sun border-2 border-ink font-bold text-sm flex items-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}{lang === 'ka' ? 'ძიება' : 'Search'}
        </button>
      </form>
      <div aria-live="polite" aria-busy={loading}>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {results.length > 0 && <ul className="max-h-52 overflow-y-auto rounded-xl border border-ink/20 divide-y divide-ink/10">
          {results.map((place, index) => <li key={`${place.lat}-${place.lng}-${index}`}><button type="button" onClick={() => {
            props.onChange(place.lat, place.lng); props.onSelectAddress?.(place.label); setQuery(place.label); setResults([]); setMessage('');
          }} className="w-full text-left px-3 py-3 text-sm font-semibold hover:bg-sun/20 flex items-start gap-2"><MapPin size={16} className="shrink-0 mt-0.5" />{place.label}</button></li>)}
        </ul>}
      </div>
      <Suspense fallback={placeholder}>
        <div className="relative isolate">
          <MapInner {...props} />
          <div className="pointer-events-none absolute z-[1000] bottom-7 left-3 bg-white border-2 border-ink rounded-lg px-2 py-1 text-[10px] font-black shadow-sticker flex items-center gap-1">
            <MapPin size={12} /> {props.lat != null && props.lng != null ? `${props.lat.toFixed(4)}, ${props.lng.toFixed(4)}` : lang === 'ka' ? 'დააწკაპუნეთ რუკაზე' : 'Click the map'}
          </div>
        </div>
      </Suspense>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground underline w-fit">Search © OpenStreetMap contributors · Photon</a>
    </div>
  );
}
