import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';
import { Loader2, Lock, Mail } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useLangStore } from '@/store/langStore';
import { useContentStore } from '@/store/contentStore';
import { Logo } from '@/components/site/Logo';

export const Route = createFileRoute('/auth')({
  component: AuthPage,
  head: () => ({ meta: [{ title: 'შესვლა · Dubuni' }] }),
});

function AuthPage() {
  const navigate = useNavigate();
  const { lang } = useLangStore();
  const passwordRecovery = useContentStore(s => s.passwordRecovery);
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset' | 'update'>('signin');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (passwordRecovery) setMode('update');
  }, [passwordRecovery]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('update');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast.error(lang === 'ka' ? 'სერვისი დროებით მიუწვდომელია' : 'Service temporarily unavailable');
      return;
    }

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');

    if ((mode !== 'update' && !email) || (mode !== 'reset' && password.length < 6)) {
      toast.error(lang === 'ka' ? 'შეიყვანე ელფოსტა და პაროლი (მინ. 6)' : 'Enter email and password (min 6 characters)');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth` });
        if (error) throw error;
        toast.success(lang === 'ka' ? 'შეამოწმეთ ელფოსტა პაროლის აღსადგენად' : 'Check your email for a password reset link');
        return;
      }
      if (mode === 'update') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success(lang === 'ka' ? 'პაროლი შეიცვალა' : 'Password updated');
        useContentStore.setState({ passwordRecovery: false });
        setMode('signin');
        return;
      }
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success(lang === 'ka' ? 'მოგესალმებით!' : 'Welcome back!');
        const userId = data.user?.id;
        let isAdmin = false;
        if (userId) {
          const { data: r } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('role', 'admin')
            .maybeSingle();
          isAdmin = !!r;
        }
        navigate({ to: isAdmin ? '/admin' : '/account' });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/account` },
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!data.session) {
          toast.success(lang === 'ka' ? 'შეამოწმეთ ელფოსტა და დაადასტურეთ ანგარიში' : 'Check your email to confirm your account before signing in');
          setMode('signin');
          return;
        }
        toast.success(lang === 'ka' ? 'მოგესალმებით Dubuni-ში!' : 'Welcome to Dubuni!');
        navigate({ to: '/account' });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (lang === 'ka' ? 'კავშირი ვერ დამყარდა' : 'Unable to connect. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    formRef.current?.reset();
  };

  return (
    <div className="min-h-screen bg-cream paper flex flex-col">
      <Toaster richColors position="top-right" />

      <header className="px-4 pt-6 flex items-center justify-between max-w-md mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="w-11 h-11" />
          <span className="font-display text-xl text-ink">Dubuni</span>
        </Link>
        <Link
          to="/"
          className="text-[11px] font-black uppercase tracking-wider text-ink/50 hover:text-coral"
        >
          {lang === 'ka' ? 'მთავარი' : 'Home'}
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md relative z-20">
          <div className="bg-white border-[3px] border-ink rounded-[2.5rem] shadow-sticker-lg p-8 relative isolate">
            <div className="washi washi-sun -top-3 left-12 -rotate-2 rounded-sm" aria-hidden />
            <div className="washi washi-grass -top-2 right-10 rotate-3 rounded-sm" aria-hidden />

            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-coral text-white border-[3px] border-ink shadow-sticker -rotate-3 flex items-center justify-center">
                <Lock size={20} />
              </div>
              <h1 className="font-display text-3xl text-ink">
                {mode === 'reset' ? (lang === 'ka' ? 'ბმულის გაგზავნა' : 'Send reset link') : mode === 'update' ? (lang === 'ka' ? 'პაროლის შენახვა' : 'Save password') : mode === 'signin'
                  ? lang === 'ka'
                    ? 'შესვლა'
                    : 'Sign In'
                  : lang === 'ka'
                    ? 'რეგისტრაცია'
                    : 'Sign Up'}
              </h1>
            </div>
            <p className="text-sm text-ink/60 font-medium mb-6">
              {mode === 'reset' || mode === 'update' ? (lang === 'ka' ? 'აღადგინეთ წვდომა თქვენს ანგარიშზე' : 'Recover access to your account') : mode === 'signin'
                ? lang === 'ka'
                  ? 'შედი და ნახე შენი ჯავშნები'
                  : 'Sign in to view your bookings'
                : lang === 'ka'
                  ? 'შექმენი ანგარიში სწრაფად'
                  : 'Create an account in seconds'}
            </p>

            {!isSupabaseConfigured && <p role="alert" className="mb-4 text-sm text-destructive">{lang === 'ka' ? 'ავტორიზაცია ჯერ არ არის გამართული. საჭიროა Supabase-ის კონფიგურაცია.' : 'Authentication is not configured yet. Supabase connection settings are missing.'}</p>}
            {(mode === 'reset' || mode === 'update') && <p className="mb-4 font-bold">{mode === 'reset' ? (lang === 'ka' ? 'პაროლის აღდგენა' : 'Reset password') : (lang === 'ka' ? 'ახალი პაროლი' : 'Choose a new password')}</p>}
            <form
              key={mode}
              ref={formRef}
              onSubmit={submit}
              className="flex flex-col gap-3"
              autoComplete="on"
            >
              {mode !== 'update' && <Field
                id="auth-email"
                name="email"
                icon={<Mail size={16} />}
                type="email"
                autoComplete="email"
                required
                placeholder={lang === 'ka' ? 'თქვენი ელფოსტა' : 'Your email address'}
              />}
              {mode !== 'reset' && <Field
                id="auth-password"
                name="password"
                icon={<Lock size={16} />}
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                placeholder={lang === 'ka' ? 'პაროლი (მინ. 6)' : 'Password (min 6)'}
              />}

              <button
                type="submit"
                disabled={loading || !isSupabaseConfigured}
                className="mt-2 py-3.5 rounded-xl bg-coral text-white border-[3px] border-ink font-black text-sm uppercase tracking-widest shadow-sticker press disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="animate-spin" size={16} />}
                {mode === 'reset' ? (lang === 'ka' ? 'ბმულის გაგზავნა' : 'Send reset link') : mode === 'update' ? (lang === 'ka' ? 'პაროლის შენახვა' : 'Save password') : mode === 'signin'
                  ? lang === 'ka'
                    ? 'შესვლა'
                    : 'Sign In'
                  : lang === 'ka'
                    ? 'რეგისტრაცია'
                    : 'Create account'}
              </button>
            </form>

            {mode === 'signin' && <button type="button" onClick={() => setMode('reset')} className="w-full mt-4 text-sm font-bold text-coral">{lang === 'ka' ? 'დაგავიწყდა პაროლი?' : 'Forgot password?'}</button>}
            <button
              type="button"
              onClick={switchMode}
              className="w-full mt-4 text-xs text-ink/70 hover:text-coral font-bold"
            >
              {mode === 'signin'
                ? lang === 'ka'
                  ? 'არ გაქვს ანგარიში? შექმენი'
                  : "Don't have an account? Sign up"
                : lang === 'ka'
                  ? 'უკვე გაქვს ანგარიში? შედი'
                  : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  name,
  icon,
  type,
  required,
  minLength,
  placeholder,
  autoComplete,
}: {
  id: string;
  name: string;
  icon: React.ReactNode;
  type: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-ink/50">
        {icon}
      </span>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="relative z-[1] w-full pl-10 pr-4 py-3.5 rounded-xl bg-cream border-[3px] border-ink font-bold text-ink placeholder:text-ink/35 focus:outline-none focus:ring-4 focus:ring-sun/40"
      />
    </div>
  );
}
