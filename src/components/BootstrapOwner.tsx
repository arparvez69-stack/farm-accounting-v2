import React, { useState } from 'react';
import { ShieldCheck, Sprout, Building, Mail, Key } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, bootstrapSystemOwner } from '../firebase/firebaseClient';
import { SystemConfig } from '../types';

interface Props {
  onBootstrapped: (config: SystemConfig) => void;
}

export const BootstrapOwner: React.FC<Props> = ({ onBootstrapped }) => {
  const [isExistingAccount, setIsExistingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('সমন্বিত কৃষি খামার (Integrated Farm)');
  const [companyAddress, setCompanyAddress] = useState('ঢাকা, বাংলাদেশ');
  const [phone, setPhone] = useState('+8801700000000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let uid = '';
      const userEmail = email.trim() || 'owner@agroerp.bd';

      if (isExistingAccount) {
        try {
          const userCred = await signInWithEmailAndPassword(auth, userEmail, password);
          uid = userCred.user.uid;
        } catch (authErr: any) {
          if (
            authErr.code === 'auth/operation-not-allowed' ||
            authErr.code === 'auth/admin-restricted-operation' ||
            authErr.code === 'auth/configuration-not-found'
          ) {
            console.warn('Firebase Email/Password provider not enabled. Continuing with local owner authorization.', authErr);
            uid = `owner_${Date.now()}`;
          } else {
            throw authErr;
          }
        }
      } else {
        if (password.length < 6) {
          throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে (Minimum 6 characters).');
        }
        try {
          const userCred = await createUserWithEmailAndPassword(auth, userEmail, password);
          uid = userCred.user.uid;
        } catch (authErr: any) {
          if (
            authErr.code === 'auth/operation-not-allowed' ||
            authErr.code === 'auth/admin-restricted-operation' ||
            authErr.code === 'auth/configuration-not-found'
          ) {
            console.warn('Firebase Email/Password provider not enabled. Continuing with local owner authorization.', authErr);
            uid = `owner_${Date.now()}`;
          } else {
            throw authErr;
          }
        }
      }

      // Securely initialize system config with this UID as the sole OWNER
      const config = await bootstrapSystemOwner(
        uid,
        userEmail,
        companyName.trim(),
        companyAddress.trim(),
        phone.trim()
      );

      // Save local credentials so user can log in locally even if Firebase Auth Email Provider is disabled
      localStorage.setItem('local_owner_credentials', JSON.stringify({
        uid,
        email: userEmail,
        password: password
      }));
      localStorage.setItem('local_auth_user', JSON.stringify({
        uid,
        email: userEmail,
        displayName: 'খামার মালিক (Owner)',
        role: 'OWNER'
      }));

      onBootstrapped(config);
    } catch (err: any) {
      console.error('Bootstrap error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('এই ইমেইলটি ইতিমধ্যে ব্যবহৃত। "লগইন করুন" নির্বাচন করে চালিয়ে যান।');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('ভুল ইমেইল বা পাসওয়ার্ড প্রদান করা হয়েছে।');
      } else {
        setError(err.message || 'নিবন্ধন প্রক্রিয়া সম্পন্ন করা যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineQuickDemo = async () => {
    setError(null);
    setLoading(true);
    try {
      const demoUid = 'demo_owner_offline';
      const demoEmail = 'owner@agroerp.bd';
      const config = await bootstrapSystemOwner(
        demoUid,
        demoEmail,
        companyName.trim() || 'সমন্বিত কৃষি খামার (Integrated Farm)',
        companyAddress.trim() || 'ঢাকা, বাংলাদেশ',
        phone.trim() || '+8801700000000'
      );
      localStorage.setItem('local_auth_user', JSON.stringify({
        uid: demoUid,
        email: demoEmail,
        displayName: 'খামার মালিক (Owner)',
        role: 'OWNER'
      }));
      onBootstrapped(config);
    } catch (err: any) {
      setError(`অফলাইন ডেমো চালু করা যায়নি: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-emerald-600/20 border border-emerald-500/40 rounded-2xl flex items-center justify-center mx-auto mb-3 text-emerald-400">
            <Sprout className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            খামার মালিক ইনিশিয়ালাইজেশন
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Secure Owner Bootstrap — প্রথমবার সিস্টেম সেটআপ
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-[11px] text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>একটিমাত্র অনুমোদিত মালিক একাউন্ট সুরক্ষিত হবে</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              খামারের নাম (Farm/Business Name)
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="যেমন: গ্রিন এগ্রো লিমিটেড"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              খামারের ঠিকানা ও ফোন (Address & Phone)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="ঠিকানা"
                className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801XXXXXXXXX"
                className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">
                মালিকের একাউন্ট তথ্য (Owner Credentials)
              </span>
              <button
                type="button"
                onClick={() => setIsExistingAccount(!isExistingAccount)}
                className="text-[11px] text-emerald-400 hover:underline"
              >
                {isExistingAccount ? 'নতুন একাউন্ট তৈরি করুন' : 'ইতিমধ্যে একাউন্ট আছে?'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="মালিকের ইমেইল (Owner Email)"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="গোপন পাসওয়ার্ড (Password)"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-50 mt-4 cursor-pointer"
          >
            {loading ? 'প্রক্রিয়াকরণ হচ্ছে...' : isExistingAccount ? 'লগইন করে সিস্টেম শুরু করুন' : 'নিবন্ধন ও সিস্টেম শুরু করুন'}
          </button>

          <div className="pt-3 text-center">
            <button
              type="button"
              disabled={loading}
              onClick={handleOfflineQuickDemo}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors underline cursor-pointer py-1"
            >
              🚀 এক ক্লিকে অফলাইন ডেমো দিয়ে শুরু করুন (Offline Quick Demo)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
