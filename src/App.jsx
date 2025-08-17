import React, { useEffect, useMemo, useRef, useState } from "react";

const COURT_NAME = "TerraKort";
const LOCATION_TEXT = "Kansal, Chandigarh";
const TIMEZONE = "Asia/Kolkata";
const OPENING_HOUR = 6;
const CLOSING_HOUR = 23;
const DEFAULT_SLOT_MINUTES = 60;

const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesSinceMidnight = (d) => d.getHours() * 60 + d.getMinutes();
const clamp = (min, val, max) => Math.min(Math.max(val, min), max);

function tzFormat(date, opts = {}) {
  try { return new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, ...opts }).format(date); }
  catch { return new Intl.DateTimeFormat("en-IN", opts).format(date); }
}
function humanTimeLabelFromMinutes(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(min)} ${suffix}`;
}
function overlaps(aStart, aDur, bStart, bDur) {
  const aEnd = aStart + aDur; const bEnd = bStart + bDur;
  return aStart < bEnd && bStart < aEnd;
}

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL; // e.g. https://<project-ref>.functions.supabase.co

export default function TerraKortApp() {
  const [slotMinutes, setSlotMinutes] = useState(DEFAULT_SLOT_MINUTES);
  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [selected, setSelected] = useState([]); // {dateKey, start}
  const [sport, setSport] = useState("padel");
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [toast, setToast] = useState(null);

  const [shadowBookings, setShadowBookings] = useState([]); // UI-only greying

  const nextDays = useMemo(() => {
    const arr = [], base = new Date(); base.setHours(0,0,0,0);
    for (let i=0;i<14;i++){ const d = new Date(base); d.setDate(base.getDate()+i); arr.push(d); }
    return arr;
  }, []);

  const todaysMinutes = minutesSinceMidnight(new Date());
  const todayKey = dateKey(new Date());

  const daySlots = useMemo(() => {
    const arr = []; const startMin = OPENING_HOUR*60; const endMin = CLOSING_HOUR*60;
    for (let m=startMin; m + slotMinutes <= endMin; m += slotMinutes) arr.push({ start: m, label: humanTimeLabelFromMinutes(m) });
    return arr;
  }, [slotMinutes]);

  function isPastSlot(dKey, start){ return dKey === todayKey ? start <= todaysMinutes : false; }
  function isAlreadyBooked(dKey, start){
    for (const s of shadowBookings){
      if (s.dateKey===dKey && overlaps(s.start, s.minutes, start, slotMinutes)) return true;
    }
    return false;
  }
  function isSelected(dKey, start){ return selected.some(s=>s.dateKey===dKey && s.start===start); }
  function toggleSlot(d, start){
    const dKey = dateKey(d);
    if (isPastSlot(dKey,start) || isAlreadyBooked(dKey,start)) return;
    setSelected(prev => {
      const exists = prev.find(s => s.dateKey===dKey && s.start===start);
      if (exists) return prev.filter(s => !(s.dateKey===dKey && s.start===start));
      return [...prev, {dateKey:dKey,start}].sort((a,b)=>a.dateKey===b.dateKey? a.start-b.start: a.dateKey.localeCompare(b.dateKey));
    });
  }
  function removeSelected(dKey,start){ setSelected(prev=>prev.filter(s=>!(s.dateKey===dKey && s.start===start))); }
  function clearSelected(){ setSelected([]); }
  function showToast(msg){ setToast(msg); setTimeout(()=>setToast(null), 3000); }

  async function confirmAndPayRazorpay(){
    if (!selected.length) return showToast("Please select at least one slot.");
    if (!form.name || !form.phone) return showToast("Please fill your name and phone.");
    try{
      const resp = await fetch(`${FUNCTIONS_BASE}/create-order`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          name: form.name, phone: form.phone, email: form.email, notes: form.notes,
          sport, slotMinutes, slots: selected
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to create order");
      const { order_id, amount, currency, key_id } = data;

      // Shadow block UI while paying
      setShadowBookings(prev => [...prev, ...selected.map(s=>({...s, minutes: slotMinutes}))]);
      clearSelected();

      const options = {
        key: key_id,
        order_id,
        name: COURT_NAME,
        description: `Court booking — ${sport}`,
        image: undefined,
        prefill: { name: form.name, email: form.email, contact: form.phone },
        notes: { sport, slotMinutes, location: LOCATION_TEXT },
        theme: { color: "#4f46e5" },
        modal: { ondismiss: () => showToast("Payment dismissed.") },
        handler: async function (response){
          try{
            const verify = await fetch(`${FUNCTIONS_BASE}/verify-payment`, {
              method: "POST",
              headers: { "Content-Type":"application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            const vr = await verify.json();
            if (!verify.ok) throw new Error(vr.error || "Verification failed");
            showToast("Payment successful & booking confirmed!");
          }catch(e){
            console.error(e);
            showToast(e.message);
          }
        }
      };
      // @ts-ignore
      const rz = new window.Razorpay(options);
      rz.open();
    }catch(e){
      console.error(e);
      showToast(e.message);
    }
  }

  const heroRef = useRef(null);

  function DayChip({ d }){
    const dKey = dateKey(d);
    const isActive = dKey === dateKey(selectedDate);
    const label = d.toLocaleDateString("en-IN", { weekday: "short" });
    const dayNum = d.getDate();
    const isToday = dKey === todayKey;
    return (
      <button onClick={()=>setSelectedDate(new Date(d))}
        className={`group relative flex flex-col items-center justify-center rounded-2xl border px-3 py-2 transition ${isActive? "border-indigo-500 bg-indigo-50":"border-zinc-200 bg-white hover:bg-zinc-50"}`}
        title={d.toDateString()}>
        <span className={`text-xs ${isActive? "text-indigo-700":"text-zinc-500"}`}>{label}</span>
        <span className={`text-lg font-semibold ${isActive? "text-indigo-800":"text-zinc-800"}`}>{dayNum}</span>
        {isToday && <span className="absolute -top-1 -right-1 rounded-full bg-emerald-500 px-1.5 text-[10px] font-medium text-white">Today</span>}
      </button>
    );
  }
  function SlotButton({ start }){
    const dKey = dateKey(selectedDate);
    const disabled = isPastSlot(dKey,start) || isAlreadyBooked(dKey,start);
    const active = isSelected(dKey,start);
    return (
      <button onClick={()=>toggleSlot(selectedDate,start)} disabled={disabled}
        className={`relative w-full rounded-xl border px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 ${disabled? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400": active? "border-indigo-500 bg-indigo-600/10 ring-indigo-400":"border-zinc-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"}`}
        title={`${humanTimeLabelFromMinutes(start)} — ${slotMinutes} min`}>
        <div className="flex items-center justify-between gap-3">
          <span className={`font-medium ${active? "text-indigo-800": disabled? "text-zinc-400":"text-zinc-800"}`}>{humanTimeLabelFromMinutes(start)}</span>
          <span className={`text-xs ${active? "text-indigo-700": disabled? "text-zinc-400":"text-zinc-500"}`}>{slotMinutes} min</span>
        </div>
        {active && <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-indigo-400/70" />}
        {disabled && <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-zinc-200 px-1.5 text-[10px] font-medium text-zinc-600">Unavailable</span>}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-indigo-50 text-zinc-800">
      <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/80 border-b border-zinc-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-amber-500 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor" aria-hidden>
                <path d="M12 2a7 7 0 0 0-5.657 11.314l-3.02 3.02a2.5 2.5 0 1 0 3.536 3.536l3.02-3.02A7 7 0 1 0 12 2Zm3 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <circle cx="19" cy="5" r="2" />
              </svg>
            </div>
            <a href="#top" className="text-lg font-semibold tracking-tight">{COURT_NAME}</a>
            <span className="hidden text-sm text-zinc-500 sm:inline">Luxury Padel Court</span>
          </div>
          <nav className="flex items-center gap-3">
            <a href="#booking" className="rounded-xl border border-indigo-200 bg-indigo-600/90 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-600">Book Slots</a>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_30%_at_70%_10%,rgba(99,102,241,0.15),transparent),radial-gradient(30%_20%_at_20%_40%,rgba(245,158,11,0.18),transparent)]" />
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-20">
          <div>
            <h1 className="text-4xl font-black leading-tight tracking-tight md:text-5xl">
              {COURT_NAME}: <span className="bg-gradient-to-r from-indigo-600 to-amber-600 bg-clip-text text-transparent">Premium Padel and pickleball court</span> in Tricity
            </h1>
            <p className="mt-4 text-lg text-zinc-600">Play under premium lights on pro-grade turf. Book multiple slots across days in a few taps.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="#booking" className="rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold shadow hover:border-indigo-300 hover:bg-indigo-50">Reserve Your Court</a>
              <a href="#features" className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-semibold hover:border-amber-300 hover:bg-amber-50">Explore Amenities</a>
            </div>
            <p className="mt-6 text-sm text-zinc-500">{LOCATION_TEXT} • Open {OPENING_HOUR}:00 — {CLOSING_HOUR}:00</p>
          </div>
          <div className="relative">
            <div className="absolute inset-0 -rotate-3 rounded-3xl bg-gradient-to-br from-amber-200 to-indigo-200 blur-2xl" />
            <div className="relative rounded-3xl border border-zinc-200 bg-white p-4 shadow-xl">
              <img src="https://www.shutterstock.com/shutterstock/photos/2335537937/display_1500/stock-photo-padel-tennis-player-with-racket-in-hand-paddle-tenis-on-a-blue-background-download-in-high-2335537937.jpg" alt="Padel & Pickleball at TerraKort" className="aspect-[4/3] w-full rounded-2xl object-cover" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-600">
                <span className="rounded-lg border border-zinc-200 bg-white px-2 py-1">Night Lighting</span>
                <span className="rounded-lg border border-zinc-200 bg-white px-2 py-1">Pro Turf</span>
                <span className="rounded-lg border border-zinc-200 bg-white px-2 py-1">Locker & Showers</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">Why {COURT_NAME}?</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {["Premium LED floodlights","Spain-inspired lounge","Pro-grade turf","Easy multi-slot booking"].map((f) => (
            <div key={f} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium">{f}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="booking" className="border-t border-zinc-200 bg-white/60 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Book Your Slots</h2>
              <p className="mt-1 text-sm text-zinc-600">Select multiple slots across any day. Past times are disabled.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600">Duration</label>
              <select value={slotMinutes}
                onChange={(e)=>setSlotMinutes(clamp(30, parseInt(e.target.value,10)||DEFAULT_SLOT_MINUTES, 180))}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
            </div>
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-3">
            {nextDays.map((d) => (<DayChip key={dateKey(d)} d={d} />))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input type="date" value={dateKey(selectedDate)} onChange={(e) => {
                const [y,m,d] = e.target.value.split("-").map(n=>parseInt(n,10));
                const nd = new Date(y, m-1, d); nd.setHours(0,0,0,0); setSelectedDate(nd);
              }}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"/>
            <span className="text-sm text-zinc-500">{tzFormat(selectedDate, { weekday:"long", day:"numeric", month:"short" })}</span>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {daySlots.map((s) => (<SlotButton key={s.start} start={s.start} />))}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="md:col-span-1">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Selected Slots</h3>
                  <button onClick={clearSelected} className="text-sm text-indigo-600 hover:underline">Clear</button>
                </div>
                <ul className="mt-3 space-y-2">
                  {selected.length ? (
                    [...selected].sort((a,b)=>a.dateKey===b.dateKey? a.start-b.start : a.dateKey.localeCompare(b.dateKey))
                    .map((s)=>(
                      <li key={`${s.dateKey}-${s.start}`} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{s.dateKey}</div>
                          <div className="text-zinc-600">{humanTimeLabelFromMinutes(s.start)} • {slotMinutes} min</div>
                        </div>
                        <button onClick={()=>removeSelected(s.dateKey, s.start)} className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-white">Remove</button>
                      </li>
                    ))
                  ) : (
                    <li className="rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-6 text-center text-sm text-zinc-500">No slots selected yet.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h3 className="text-lg font-semibold">Your Details</h3>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm text-zinc-600">Full Name</label>
                    <input type="text" value={form.name} onChange={(e)=>setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Heena Kataria"
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="text-sm text-zinc-600">Phone</label>
                    <input type="tel" value={form.phone} onChange={(e)=>setForm({ ...form, phone: e.target.value })}
                      placeholder="+91 XXXXX XXXXX"
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="text-sm text-zinc-600">Email (optional)</label>
                    <input type="email" value={form.email} onChange={(e)=>setForm({ ...form, email: e.target.value })}
                      placeholder="you@example.com"
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="text-sm text-zinc-600">Notes (optional)</label>
                    <input type="text" value={form.notes} onChange={(e)=>setForm({ ...form, notes: e.target.value })}
                      placeholder="Racket rental, coaching, etc."
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"/>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button onClick={confirmAndPayRazorpay}
                    className="rounded-2xl border border-indigo-200 bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600/90">
                    Confirm & Pay (Razorpay)
                  </button>
                </div>

                <p className="mt-3 text-xs text-zinc-500">Payment handled via Razorpay; booking confirms after successful verification.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 border-t border-zinc-200 bg-white/80">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row">
          <p className="text-sm text-zinc-600">© {new Date().getFullYear()} {COURT_NAME}. All rights reserved.</p>
          <p className="text-sm text-zinc-500">Need help? Email <a className="underline" href="mailto:tech@merakiads.in">tech@merakiads.in</a></p>
        </div>
      </footer>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="pointer-events-auto rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}

function DayChip(){return null} // placeholder (vite fast refresh will replace)
function SlotButton(){return null} // placeholder
