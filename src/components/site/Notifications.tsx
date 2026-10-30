import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { watchUpdates } from '@/integrations/supabase/updates';
import { useContentStore } from '@/store/contentStore';
import { Link, useLocation } from '@tanstack/react-router';

interface Notif {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  booking_id: string | null;
  type: string;
}

export function NotificationBell() {
  const { user } = useContentStore();
  const location = useLocation();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user) { setItems([]); return; }
    let cancel = false;
    setItems([]);
    const stop = watchUpdates('notif-' + user.id, [{ table: 'notifications', filter: `user_id=eq.${user.id}` }], async () => {
      const { data, error } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      if (!cancel && !error) setItems(data || []);
    });
    return () => { cancel = true; stop(); };
  }, [user?.id]);

  if (!user) return null;

  const markAllRead = async () => {
    if (!unread) return;
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    const read_at = new Date().toISOString();
    const { error } = await supabase.from('notifications').update({ read_at }).in('id', ids);
    if (!error) setItems(prev => prev.map(item => ids.includes(item.id) ? { ...item, read_at } : item));
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) markAllRead(); }}
        className="relative inline-flex items-center justify-center w-10 h-10 bg-white border-[3px] border-ink rounded-xl shadow-sticker text-ink hover:bg-cream"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-2 -right-2 bg-coral text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-[2px] border-ink">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 w-[320px] max-w-[92vw] bg-white border-[3px] border-ink rounded-2xl shadow-sticker-md z-40 overflow-hidden">
            <div className="px-4 py-3 border-b-[2px] border-dashed border-ink/20 flex items-center justify-between">
              <span className="font-display text-lg text-ink">შეტყობინებები</span>
              {items.length > 0 && <Link to="/account" onClick={() => setOpen(false)} className="text-[11px] font-black uppercase tracking-wider text-coral">ყველა</Link>}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground italic">შეტყობინება არ არის</p>}
              {items.map((n) => (
                <div key={n.id} className={`px-4 py-3 border-b border-dashed border-ink/10 last:border-0 ${n.read_at ? 'opacity-70' : 'bg-sun/10'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-bold text-sm text-ink">{n.title}</p>
                      {n.body && <p className="text-xs text-ink/70 mt-1">{n.body}</p>}
                      <p className="text-[10px] uppercase tracking-wider text-ink/40 mt-1">{new Date(n.created_at).toLocaleString('ka-GE')}</p>
                    </div>
                    {!n.read_at && <span className="w-2 h-2 rounded-full bg-coral mt-1 flex-shrink-0" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
