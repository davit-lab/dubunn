import { createFileRoute, Link } from '@tanstack/react-router';
import { useLangStore } from '@/store/langStore';
import { useContentStore } from '@/store/contentStore';
import { useCartStore } from '@/store/cartStore';
import { useEffect, useState } from 'react';
import { Calendar, Users, ShoppingBag, Check, Trash2, Loader2, MapPin, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { CITIES, DEFAULT_CITY } from '@/lib/cities';
import { MapPicker } from '@/components/site/MapPicker';

export const Route = createFileRoute('/booking')({ component: BookingPage });

function BookingPage() {
  const { lang } = useLangStore();
  const { translations, assets, user } = useContentStore();
  const t = translations[lang];
  const cart = useCartStore();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '', address: '', comments: '', city: DEFAULT_CITY.id, lat: null as number | null, lng: null as number | null });
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [selectedEmoji, setSelectedEmoji] = useState('');
  const [selectedAnimator, setSelectedAnimator] = useState<any>(null);

  const animators = (t.animators || []) as any[];
  const hosts = (t.hosts || []) as any[];
  const services = (t.services || []) as any[];
  const timeSlots = (t.timeSlots || []) as any[];
  const programs = (t.programs || []) as any[];

  const selectedProgram = programs.find((p: any) => p.id === cart.programId) || null;
  const includesHero = selectedProgram?.includedHeroes != null
    ? Number(selectedProgram.includedHeroes) > 0
    : selectedProgram?.id === programs[0]?.id;
  const [includedHeroId, setIncludedHeroId] = useState<string | null>(null);
  const freeHeroId = includesHero ? includedHeroId : null;
  const selectedPeople = Object.values(cart.animators);
  const people = [...animators, ...hosts];
  const pricedPeople = selectedPeople.map((a) => ({
    ...a,
    quantity: 1,
    hours: 1,
    pricePerHour: a.id === freeHeroId ? 0 : Number(people.find(p => p.id === a.id)?.pricePerHour || 0),
  }));

  const slot = timeSlots.find((s) => s.time === cart.timeSlotTime);

  // Load booked slots whenever date changes
  useEffect(() => {
    if (!cart.date) { setBookedTimes([]); return; }
    let cancelled = false;
    (supabase.rpc as any)('get_booked_slots', { _date: cart.date }).then(({ data, error }: any) => {
      if (cancelled) return;
      if (error) { console.error(error); }
      const rpcTimes = (data || []).map((r: any) => r.time_slot_time).filter(Boolean);
      const adminBlocked: string[] = (assets?.blockedSlots?.[cart.date] || []);
      const times = Array.from(new Set([...rpcTimes, ...adminBlocked]));
      setBookedTimes(times);
      if (cart.timeSlotTime && times.includes(cart.timeSlotTime)) {
        cart.setTimeSlot(null);
      }
    });
    return () => { cancelled = true; };
  }, [cart.date, assets?.blockedSlots]);


  const programPrice = Number(selectedProgram?.price ?? selectedProgram?.pricePerHour ?? 0);

  const animatorsTotal = pricedPeople.reduce((sum, a) => sum + a.pricePerHour, 0);
  const servicesTotal = Object.values(cart.services).reduce((sum, s) => sum + s.price, 0);
  const total = Math.round(programPrice + animatorsTotal + servicesTotal);

  const togglePerson = (a: any) => {
    if (cart.animators[a.id]) {
      cart.removeAnimator(a.id);
      if (a.id === freeHeroId) setIncludedHeroId(null);
    } else {
      if (includesHero && !freeHeroId && animators.some(hero => hero.id === a.id)) setIncludedHeroId(a.id);
      cart.setAnimator({ id: a.id, name: a.name, pricePerHour: a.pricePerHour, image: a.image, quantity: 1, hours: 1 });
    }
  };

  const submit = async () => {
    if (!cart.programId || (includesHero && !freeHeroId)) {
      toast.error(lang === 'ka' ? 'აირჩიეთ პროგრამა და მასში შემავალი გმირი' : 'Choose a program and its included hero');
      return;
    }
    if (!cart.date || !cart.timeSlotTime || !customer.name || !customer.phone || !customer.address) {
      toast.error(lang === 'ka' ? 'შეავსეთ აუცილებელი ველები (სახელი, ტელეფონი, მისამართი, თარიღი, დრო)' : 'Fill required fields (name, phone, address, date, time)');
      return;
    }
    setSubmitting(true);
    // Re-check slot availability to avoid race conditions
    const adminBlocked: string[] = (assets?.blockedSlots?.[cart.date] || []);
    if (adminBlocked.includes(cart.timeSlotTime)) {
      setSubmitting(false);
      cart.setTimeSlot(null);
      toast.error(lang === 'ka' ? 'ეს დრო დაბლოკილია' : 'This time slot is blocked');
      return;
    }
    const { data: latest } = await (supabase.rpc as any)('get_booked_slots', { _date: cart.date });
    const latestTimes = (latest || []).map((r: any) => r.time_slot_time);
    if (latestTimes.includes(cart.timeSlotTime)) {
      setSubmitting(false);
      setBookedTimes(latestTimes);
      cart.setTimeSlot(null);
      toast.error(lang === 'ka' ? 'ეს დრო უკვე დაკავებულია' : 'This time was just booked');
      return;
    }
    const program = programs.find((p) => p.id === cart.programId) || null;
    const { error } = await supabase.from('bookings').insert([{
      user_id: user?.id || null,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email || user?.email || null,
      address: customer.address,
      city: CITIES.find(c => c.id === customer.city)?.[lang as 'ka' | 'en'] || customer.city,
      address_lat: customer.lat,
      address_lng: customer.lng,
      comments: customer.comments || null,
      booking_date: cart.date,
      time_slot: (slot ? { ...slot, territoryPrice: 0, multiplier: 1 } : null) as any,
      program: (program ? { ...program, price: programPrice } : null) as any,
      animators: pricedPeople as any,
      services: Object.values(cart.services).map(s => ({ ...s, quantity: 1, hours: 1 })) as any,
      total_price: total,
    } as any]);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.ui.bookingSuccess);
    
    // Select random cute emoji
    const cuteEmojis = ['🎉', '🎈', '🎁', '⭐', '🌟', '💖', '🎊', '🦄', '🎀', '🌈', '🎂', '🎭', '🎪'];
    setSelectedEmoji(cuteEmojis[Math.floor(Math.random() * cuteEmojis.length)]);
    
    // Select random animator for popup
    if (animators.length > 0) {
      setSelectedAnimator(animators[Math.floor(Math.random() * animators.length)]);
    }
    
    setDone(true);
    cart.clear();
    setCustomer({ name: '', phone: '', email: '', address: '', comments: '', city: DEFAULT_CITY.id, lat: null, lng: null });
  };

  // ── Auth gate ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4 py-20 paper relative overflow-hidden">
        <Toaster richColors position="top-right" />
        {/* decorative dots */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, rgba(45,51,74,.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative max-w-sm w-full flex flex-col items-center gap-7 text-center">
          {/* sticker icon */}
          <div className="relative">
            <div className="w-28 h-28 rounded-[2rem] bg-sun border-[3px] border-ink flex items-center justify-center shadow-sticker-md -rotate-3">
              <Lock size={40} className="text-ink" />
            </div>
            <span className="absolute -top-2 -right-2 text-2xl rotate-12">🔑</span>
          </div>
          <div>
            <h2 className="font-display text-5xl text-ink mb-2">
              {lang === 'ka' ? 'ავტორიზაცია საჭიროა' : 'Login Required'}
            </h2>
            <p className="text-muted-foreground font-semibold text-sm leading-relaxed">
              {lang === 'ka'
                ? 'ჯავშნის გვერდზე წვდომისთვის გთხოვთ გაიაროთ ავტორიზაცია ან დარეგისტრირდეთ.'
                : 'Please log in or register to make a booking.'}
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <Link to="/auth" className="flex-1 py-4 rounded-2xl bg-grass text-white border-[3px] border-ink font-black text-sm uppercase tracking-wider shadow-sticker text-center press">
              {lang === 'ka' ? 'შესვლა' : 'Log In'}
            </Link>
            <Link to="/auth" className="flex-1 py-4 rounded-2xl bg-sun text-ink border-[3px] border-ink font-black text-sm uppercase tracking-wider shadow-sticker text-center press">
              {lang === 'ka' ? 'რეგისტრაცია' : 'Register'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const step1Done = !!(cart.date && cart.timeSlotTime);
  const step2Done = !!cart.programId;
  const step3Done = step2Done && (!includesHero || !!freeHeroId);
  const step5Done = !!(customer.name && customer.phone && customer.address);

  // ── Success overlay ──────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/70 backdrop-blur-md">
        <div className="relative bg-cream border-[3px] border-ink rounded-[2.5rem] px-8 py-10 max-w-sm w-full text-center shadow-sticker-xl flex flex-col items-center gap-5 overflow-hidden">
          {/* washi tape top decoration */}
          <div className="washi washi-coral absolute -top-3 left-1/2 -translate-x-1/2 rotate-1 rounded-sm opacity-90" />
          {/* bg confetti dots */}
          <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: 'radial-gradient(circle, var(--sun) 1.5px, transparent 1.5px)', backgroundSize: '22px 22px' }} />
          <div className="relative z-10 flex flex-col items-center gap-5">
            {selectedAnimator?.image && (
              <div className="relative">
                <img src={selectedAnimator.image} alt={selectedAnimator.name} className="w-32 h-32 rounded-[1.5rem] object-cover border-[3px] border-ink shadow-sticker-md -rotate-2" />
                <span className="absolute -bottom-2 -right-2 text-3xl">{selectedEmoji}</span>
              </div>
            )}
            {!selectedAnimator?.image && <div className="text-6xl animate-bounce" style={{ animationDuration: '1.8s' }}>{selectedEmoji}</div>}
            <div>
              <h2 className="font-display text-4xl text-ink">{t.ui.bookingSuccess}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm font-semibold leading-relaxed">
                {lang === 'ka' ? 'ადმინისტრატორი დაგიკავშირდება მალე! 🎉' : 'Our team will contact you soon! 🎉'}
              </p>
            </div>
            <Link to="/" className="mt-1 py-3.5 px-10 rounded-2xl bg-grass text-white border-[3px] border-ink font-black text-sm uppercase tracking-wider shadow-sticker press">
              {lang === 'ka' ? 'მთავარზე' : 'Go Home'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Main booking form ────────────────────────────────────────────────────
  return (
    <div className="pb-32 lg:pb-8 bg-cream">
      <Toaster richColors position="top-right" />

      {/* Page header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-sun/30 via-cream to-coral/10 border-b-[3px] border-ink/10 px-4 md:px-10 pt-12 pb-10">
        {/* dot grid bg */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, rgba(45,51,74,.05) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        {/* decorative circles */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-coral/10 blur-3xl" />
        <div className="absolute -bottom-6 -left-6 w-36 h-36 rounded-full bg-sun/30 blur-2xl" />
        <div className="max-w-[1200px] mx-auto relative">
          <span className="inline-block px-4 py-1.5 bg-coral text-white border-[3px] border-ink rounded-xl text-xs font-black uppercase tracking-wider shadow-sticker -rotate-1 mb-4">
            {t.ui.book}
          </span>
          <h1 className="font-display text-6xl md:text-7xl text-ink leading-none mb-1">{lang === 'ka' ? 'დაჯავშნა' : 'Booking'}</h1>
          <p className="text-muted-foreground font-semibold text-sm mb-5">{lang === 'ka' ? 'შეავსეთ ფორმა — ჩვენ დაგიკავშირდებთ!' : 'Fill the form — we\'ll confirm your booking!'}</p>
          {/* Step pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { n: 1, label: lang === 'ka' ? 'თარიღი' : 'Date', done: step1Done },
              { n: 2, label: lang === 'ka' ? 'პროგრამა' : 'Program', done: step2Done },
              { n: 3, label: lang === 'ka' ? 'გმირები' : 'Heroes', done: step3Done },
              { n: 4, label: lang === 'ka' ? 'სერვისები' : 'Services', done: true },
              { n: 5, label: lang === 'ka' ? 'კონტაქტი' : 'Contact', done: step5Done },
            ].map((s, i, arr) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-black border-[2.5px] transition-all shadow-sm ${s.done ? 'bg-grass text-white border-grass shadow-[2px_2px_0_0_rgba(45,51,74,.25)]' : 'bg-white text-ink border-ink/20'}`}>
                  {s.done ? <Check size={10} /> : <span className="w-3 text-center opacity-60">{s.n}</span>}
                  {s.label}
                </div>
                {i < arr.length - 1 && <div className={`w-4 h-0.5 rounded-full ${s.done ? 'bg-grass' : 'bg-ink/15'}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1200px] mx-auto px-4 md:px-10 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">

          {/* ── Left column: steps ── */}
          <div className="flex flex-col gap-5">

            {/* Step 1: Date & Time */}
            <StepCard step={1} done={step1Done} icon={<Calendar size={17} />} title={t.ui.pickDateTime}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <FL>{t.ui.day}</FL>
                  <input
                    type="date"
                    value={cart.date}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => cart.setDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-ink/20 font-bold text-ink focus:border-primary focus:outline-none transition"
                  />
                </div>
                <div>
                  <FL>{t.ui.session}</FL>
                  {!cart.date ? (
                    <p className="text-xs text-muted-foreground italic pt-1">{lang === 'ka' ? 'ჯერ აირჩიეთ თარიღი' : 'Select a date first'}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {timeSlots.map((s: any) => {
                        const isBooked = bookedTimes.includes(s.time);
                        const isSel = cart.timeSlotTime === s.time;
                        return (
                          <button
                            key={s.time}
                            disabled={isBooked}
                            onClick={() => cart.setTimeSlot(s.time)}
                            className={`relative p-4 rounded-2xl border-[3px] text-left transition-all press ${
                              isBooked ? 'opacity-35 cursor-not-allowed bg-muted border-ink/15 line-through'
                              : isSel ? 'bg-coral text-white border-ink shadow-sticker'
                              : 'bg-white border-ink/20 hover:border-coral/60 hover:shadow-sm'
                            }`}
                          >
                            <div className="font-display text-2xl leading-none">{s.time}</div>
                            <div className={`text-[9px] font-black uppercase tracking-wider mt-1 ${isSel ? 'text-white/80' : 'text-muted-foreground'}`}>{s.label}</div>
                            {isSel && <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center"><Check size={10} className="text-white" /></span>}
                            {isBooked && <span className="absolute top-1.5 right-1.5 text-[7px] font-black bg-destructive text-white px-1.5 py-0.5 rounded-full">{lang === 'ka' ? 'დაკ.' : 'Full'}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </StepCard>

            {/* Step 2: Program */}
            <StepCard step={2} done={step2Done} icon={<ShoppingBag size={17} />} title={t.ui.pickProgram}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {programs.map((p: any) => {
                  const isSel = cart.programId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { cart.setProgram(isSel ? null : p.id); Object.keys(cart.animators).forEach(cart.removeAnimator); setIncludedHeroId(null); }}
                      className={`relative p-5 rounded-2xl border-[3px] text-left flex flex-col gap-2 transition-all press ${
                        isSel ? 'bg-sun border-ink shadow-sticker-md' : 'bg-white border-ink/15 hover:border-ink/40 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          isSel ? 'bg-ink text-sun' : 'bg-primary/10 text-primary'
                        }`}>{p.ageRange}</span>
                        {isSel && <span className="w-6 h-6 rounded-full bg-ink flex items-center justify-center flex-shrink-0"><Check size={11} className="text-sun" /></span>}
                      </div>
                      <span className="font-display text-xl leading-tight text-ink">{p.name}</span>
                      <span className="font-bold text-coral">{p.price ?? p.pricePerHour ?? 0}₾</span>
                      <span className="text-[11px] text-muted-foreground leading-snug">{p.description}</span>
                    </button>
                  );
                })}
              </div>
            </StepCard>

            {/* Step 3: Characters */}
            <StepCard step={3} done={step3Done} icon={<Users size={17} />} title={lang === 'ka' ? 'პერსონაჟები' : 'Characters'}>
              {!selectedProgram ? (
                <p className="text-sm text-muted-foreground italic">{lang === 'ka' ? 'გთხოვთ, ჯერ აირჩიოთ პროგრამა' : 'Select a program first'}</p>
              ) : (
                <div className="flex flex-col gap-5">
                  {includesHero && <p className="text-sm font-semibold text-muted-foreground">
                    {freeHeroId
                      ? (lang === 'ka' ? 'ერთი გმირი შედის პროგრამაში. დამატებითი არჩევანი ფასიანია.' : 'One hero is included. Additional selections are priced below.')
                      : (lang === 'ka' ? 'აირჩიეთ ერთი უფასო გმირი. დამატებითი არჩევანი ფასიანია.' : 'Choose your first hero free. Additional selections cost extra.')}
                  </p>}
                  <div className="grid grid-cols-2 gap-3">
                    {people.map(a => {
                      const active = !!cart.animators[a.id];
                      const isFree = a.id === freeHeroId;
                      const canChooseFree = includesHero && !freeHeroId && !active && animators.some(hero => hero.id === a.id);
                      return (
                        <button key={a.id} type="button" aria-pressed={active} onClick={() => togglePerson(a)}
                          className={`overflow-hidden rounded-2xl border-[3px] text-left ${isFree ? 'border-grass bg-grass/10' : active ? 'border-ink bg-sun/20 shadow-sticker' : 'border-ink/15'}`}>
                          <img src={a.image} alt="" className="w-full h-36 object-cover" />
                          <div className="p-3 flex justify-between gap-2 font-bold">
                            <span>{a.name}</span>
                            <span>{isFree ? (lang === 'ka' ? 'შედის პროგრამაში' : 'Included') : canChooseFree ? (lang === 'ka' ? 'უფასო' : 'Free') : `${Math.round(a.pricePerHour)}₾`} {active && '✓'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </StepCard>

            {/* Step 4: Services */}
            <StepCard step={4} done={true} icon={<ShoppingBag size={17} />} title={t.ui.pickServices}>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {services.map((s: any) => {
                  const sel = cart.services[s.id];
                  const qty = sel?.quantity || 0;
                  return (
                    <div key={s.id} className={`flex flex-col gap-0 rounded-2xl border-[3px] overflow-hidden transition-all ${
                      qty > 0 ? 'border-ink shadow-sticker' : 'border-ink/15 bg-white hover:border-ink/40'
                    }`}>
                      {s.image
                        ? <div className="relative"><img src={s.image} alt={s.name} className="w-full h-28 object-cover" />{qty > 0 && <div className="absolute inset-0 bg-sun/20" />}{qty > 0 && <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-sun border-2 border-ink flex items-center justify-center"><Check size={10} className="text-ink" /></span>}</div>
                        : null
                      }
                      <div className="p-3 flex flex-col gap-2">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-ink">{s.name}</p>
                          {s.description && <p className="text-[10px] text-muted-foreground">{s.description}</p>}
                        </div>
                        <span className="font-display text-xl text-coral flex-shrink-0">{s.price}₾</span>
                      </div>
                      <button type="button" aria-pressed={qty > 0} onClick={() => cart.toggleService({ ...s, quantity: 1, hours: 1 })} className="py-2 rounded-xl bg-sun border-2 border-ink font-bold">
                        {qty > 0 ? (lang === 'ka' ? 'არჩეულია ✓' : 'Selected ✓') : (lang === 'ka' ? 'დამატება' : 'Add')}
                      </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </StepCard>

            {/* Step 5: Contact */}
            <StepCard step={5} done={step5Done} icon={<MapPin size={17} />} title={t.ui.contactInfo}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FL>{t.ui.name} *</FL>
                  <FI value={customer.name} onChange={v => setCustomer(c => ({ ...c, name: v }))} placeholder={lang === 'ka' ? 'სახელი' : 'Full name'} />
                </div>
                <div>
                  <FL>{t.ui.phone} *</FL>
                  <FI value={customer.phone} onChange={v => setCustomer(c => ({ ...c, phone: v }))} placeholder="+995 5XX XXX XXX" />
                </div>
                <div>
                  <FL>{t.ui.email}</FL>
                  <FI value={customer.email} onChange={v => setCustomer(c => ({ ...c, email: v }))} placeholder="email@example.com" />
                </div>
                <div>
                  <FL>{lang === 'ka' ? 'ქალაქი' : 'City'}</FL>
                  <select
                    value={customer.city}
                    onChange={(e) => setCustomer(c => ({ ...c, city: e.target.value, lat: null, lng: null }))}
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-ink/20 font-bold text-ink focus:border-primary focus:outline-none transition"
                  >
                    {CITIES.map(c => <option key={c.id} value={c.id}>{c[lang as 'ka' | 'en']}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <FL>{t.ui.address} *</FL>
                  <FI value={customer.address} onChange={v => setCustomer(c => ({ ...c, address: v }))} placeholder={lang === 'ka' ? 'ქუჩა, სახლი, ბინა' : 'Street, house, apt'} />
                </div>
                <div className="sm:col-span-2">
                  <FL>{lang === 'ka' ? 'მონიშნეთ მისამართი რუქაზე' : 'Pin on map'}</FL>
                  <div className="rounded-2xl overflow-hidden border-2 border-ink/20">
                    <MapPicker
                      lat={customer.lat}
                      lng={customer.lng}
                      centerLat={CITIES.find(c => c.id === customer.city)?.lat ?? DEFAULT_CITY.lat}
                      centerLng={CITIES.find(c => c.id === customer.city)?.lng ?? DEFAULT_CITY.lng}
                      onChange={(lat, lng) => setCustomer(c => ({ ...c, lat, lng }))}
                    />
                  </div>
                  {customer.lat && customer.lng && (
                    <p className="text-xs text-grass font-bold mt-1.5 flex items-center gap-1">
                      <Check size={10} /> {Number(customer.lat).toFixed(5)}, {Number(customer.lng).toFixed(5)}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <FL>{t.ui.comments}</FL>
                  <textarea
                    value={customer.comments}
                    onChange={e => setCustomer(c => ({ ...c, comments: e.target.value }))}
                    placeholder={lang === 'ka' ? 'დამატებითი ინფორმაცია...' : 'Additional info...'}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-ink/20 font-bold text-ink placeholder:text-ink/30 focus:border-primary focus:outline-none transition resize-none"
                  />
                </div>
              </div>
            </StepCard>

          </div>

          {/* ── Right column: sticky cart (desktop only) ── */}
          <div className="hidden lg:block">
            <div className="sticky top-24 bg-cream border-[3px] border-ink rounded-[2rem] shadow-sticker-md p-5 flex flex-col gap-4 relative overflow-hidden">
              {/* washi tape decoration */}
              <div className="washi washi-sky absolute -top-3 left-8 -rotate-2 rounded-sm" />
              <div className="flex items-center gap-3 pt-3 border-b-[2px] border-dashed border-ink/20 pb-4">
                <span className="w-10 h-10 rounded-2xl bg-coral border-[3px] border-ink flex items-center justify-center flex-shrink-0 shadow-sticker -rotate-3">
                  <ShoppingBag size={18} className="text-white" />
                </span>
                <h2 className="font-display text-2xl text-ink">{t.ui.cart}</h2>
              </div>

              <div className="flex flex-col gap-1 max-h-[360px] overflow-y-auto pr-1">
                {slot && <SR emoji="📍" label={`${slot.time} · ${slot.label}`} price="" />}
                {cart.programId && (() => { const p = programs.find((pr: any) => pr.id === cart.programId); return p ? <SR emoji="🎠" label={p.name} sub={p.ageRange} price={`${programPrice}₾`} /> : null; })()}
                {pricedPeople.map((a) => (
                  <SR key={a.id} emoji="🦸" label={a.name} sub={a.id === freeHeroId ? (lang === 'ka' ? 'შედის პროგრამაში' : 'Included') : undefined} price={`${Math.round(a.pricePerHour)}₾`} onRemove={() => { cart.removeAnimator(a.id); if (a.id === freeHeroId) setIncludedHeroId(null); }} />
                ))}
                {Object.values(cart.services).map((s) => {
                  
                  return <SR key={s.id} emoji="🎁" label={s.name} price={`${Math.round(s.price)}₾`} onRemove={() => cart.setService({ ...s, quantity: 0 })} />;
                })}
                {!slot && Object.keys(cart.animators).length === 0 && Object.keys(cart.services).length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground italic">{t.ui.emptyCart}</p>
                )}
              </div>

              <div className="border-t-[2px] border-dashed border-ink/25 pt-4 flex justify-between items-end">
                <span className="text-[9px] font-black uppercase tracking-widest text-ink/40">{t.ui.total}</span>
                <span className="font-display text-5xl text-coral leading-none">{total}₾</span>
              </div>

              <button
                disabled={submitting}
                onClick={submit}
                className="w-full py-4 rounded-2xl bg-grass text-white border-[3px] border-ink font-black text-sm uppercase tracking-wider shadow-sticker press disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <><Loader2 className="animate-spin" size={16} /> {lang === 'ka' ? 'იგზავნება...' : 'Sending...'}</> : t.ui.bookNow}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Mobile floating bar */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-cream border-t-[3px] border-ink px-4 py-3 flex items-center gap-3" style={{ boxShadow: '0 -4px 0 0 rgba(45,51,74,.12)' }}>
        <div className="flex flex-col flex-shrink-0">
          <p className="text-[8px] font-black uppercase tracking-widest text-ink/40">{t.ui.total}</p>
          <p className="font-display text-4xl text-coral leading-none">{total}₾</p>
        </div>
        {slot && (
          <div className="flex flex-col flex-shrink-0 px-2 py-1 rounded-lg bg-white border border-ink/15">
            <p className="text-[8px] font-black uppercase text-ink/40">{lang === 'ka' ? 'დრო' : 'Time'}</p>
            <p className="font-display text-base text-ink leading-none">{slot.time}</p>
          </div>
        )}
        <button
          disabled={submitting}
          onClick={submit}
          className="flex-1 py-4 rounded-2xl bg-grass text-white border-[3px] border-ink font-black text-sm uppercase tracking-wider shadow-sticker press disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="animate-spin" size={16} /> : t.ui.bookNow}
        </button>
      </div>
    </div>
  );
}

// ── Tiny helper components ───────────────────────────────────────────────────

function StepCard({ step, done, icon, title, children }: { step: number; done: boolean; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className={`relative bg-white rounded-[1.75rem] border-[3px] p-5 md:p-6 flex flex-col gap-5 transition-all ${
      done ? 'border-grass shadow-[4px_4px_0_0_var(--grass)]' : 'border-ink/15 shadow-sm hover:border-ink/30'
    }`}>
      <div className="flex items-center gap-3">
        <span className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 border-[3px] transition-all shadow-sticker ${
          done ? 'bg-grass border-grass text-white -rotate-2' : 'bg-sun border-sun text-ink rotate-1'
        }`}>
          {done ? <Check size={16} /> : icon}
        </span>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-ink/8 flex items-center justify-center text-[10px] font-black text-ink/40">{step}</span>
          <h2 className="font-display text-xl md:text-2xl text-ink leading-tight">{title}</h2>
        </div>
        {done && <span className="ml-auto text-[10px] font-black text-grass uppercase tracking-wider">{'✓ done'}</span>}
      </div>
      {children}
    </section>
  );
}

function FL({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={`block text-[10px] font-black uppercase tracking-widest text-ink/50 mb-1.5 ${className || ''}`}>{children}</label>;
}

function FI({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 rounded-xl bg-cream border-[2.5px] border-ink/20 font-bold text-ink placeholder:text-ink/25 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 transition"
    />
  );
}

function SR({ emoji, label, sub, price, onRemove }: { emoji: string; label: string; sub?: string; price: string; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5 border-b-[2px] border-dashed border-ink/12 last:border-0">
      <span className="text-base flex-shrink-0 leading-none">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-ink truncate leading-tight">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <p className="font-display text-base text-ink flex-shrink-0">{price}</p>
      {onRemove && (
        <button onClick={onRemove} className="w-6 h-6 rounded-lg bg-coral/10 hover:bg-coral/20 text-coral flex items-center justify-center transition flex-shrink-0">
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
