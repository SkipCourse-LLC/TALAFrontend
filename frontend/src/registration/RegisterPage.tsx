import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { ContactRequestInput, ContactRequestReceipt, OpenTimes } from "../api";
import { groupOpenTimes } from "../onboarding/openTimesFormat";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: OpenTimes };

const dateKeyInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const toYYYYMMDD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatMonthYear = (date: Date) => {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export function RegisterPage() {

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  // Data State
  const [load, setLoad] = useState<Load>({ state: "loading" });
  
  // Calendar State
  const [viewedMonth, setViewedMonth] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ContactRequestReceipt | null>(null);
  const requestAttempt = useRef<{ key: string; id: string } | null>(null);

  // Fetch available times
  useEffect(() => {
    const controller = new AbortController();
    talaApi
      .getPublicOpenTimes(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoad({ state: "ready", value });
          if (value.times.length > 0 && value.times[0]) {
            const firstDateKey = dateKeyInTimeZone(new Date(value.times[0].startsAt), value.timeZone);
            const firstDate = new Date(`${firstDateKey}T12:00:00`);
            setSelectedDateStr(firstDateKey);
            setViewedMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoad({ state: "error", message: safeTalaApiError(error).message });
      });
    return () => controller.abort();
  }, []);

  const groupedDays = useMemo(() => {
    if (load.state !== "ready") return [];
    return groupOpenTimes(load.value);
  }, [load]);

  const activeSlots = groupedDays.flatMap(day => day.times).filter(slot => {
    if (!selectedDateStr || load.state !== "ready") return false;
    return dateKeyInTimeZone(new Date(slot.startsAt), load.value.timeZone) === selectedDateStr;
  });
  const selectedSlot = activeSlots.find(s => s.id === selectedSlotId);

  // Calendar Math
  const year = viewedMonth.getFullYear();
  const month = viewedMonth.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); 
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const handlePrevMonth = () => { setViewedMonth(new Date(year, month - 1, 1)); setSelectedDateStr(null); setSelectedSlotId(null); };
  const handleNextMonth = () => { setViewedMonth(new Date(year, month + 1, 1)); setSelectedDateStr(null); setSelectedSlotId(null); };

  // Validation
  const phoneDigits = phone.replace(/\D/g, "").length;
  const isFormValid =
    name.trim().length > 0 &&
    email.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    phone.trim().length <= 30 &&
    /^[0-9+().\s-]+$/.test(phone.trim()) &&
    phoneDigits >= 10 && phoneDigits <= 15 &&
    address.trim().length > 0 &&
    selectedSlotId !== null;

  // Submit Registration & Booking Request
    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !isFormValid || load.state !== "ready") return;
    
    setIsSubmitting(true);
    setError("");

    try {
      const selectedOpenTime = load.value.times.find(t => t.id === selectedSlotId);
      if (!selectedOpenTime) return;

      const timeParts = (value: string) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: load.value.timeZone,
          weekday: "long",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(value));
        
      const part = (parts: Intl.DateTimeFormatPart[], type: string) =>
        parts.find((value) => value.type === type)?.value ?? "";
      
      const starts = timeParts(selectedOpenTime.startsAt);
      const ends = timeParts(selectedOpenTime.endsAt);
      const day = part(starts, "weekday").toLowerCase() as any;

      const requestPayload: Omit<ContactRequestInput, "requestId"> = {
        parentName: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        preferredMethod: "email",
        availability: [{
          day,
          startTime: `${part(starts, "hour")}:${part(starts, "minute")}`,
          endTime: `${part(ends, "hour")}:${part(ends, "minute")}`,
        }],
        notes: `Parent Registration & Enrollment Meeting. Address: ${address.trim()}`,
      };

      const key = JSON.stringify(requestPayload);
      if (requestAttempt.current?.key !== key)
        requestAttempt.current = { key, id: newRequestId() };

      const savedReceipt = await talaApi.submitContactRequest({
        ...requestPayload,
        requestId: requestAttempt.current.id,
      });

      setReceipt(savedReceipt);
    } catch (err) {
      setError(safeTalaApiError(err).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (receipt) {
    return (
      <div style={{ backgroundColor: "#f9fafb", minHeight: "100vh", padding: "3rem 1.5rem", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center" }}>
          <div style={{ width: "64px", height: "64px", backgroundColor: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          </div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "1rem", fontFamily: "Georgia, serif" }}>Registration request sent</h1>
          <p style={{ color: "#6b7280", fontSize: "1.125rem", marginBottom: "2rem" }}>
            Thank you, {name}. We have received your enrollment request and your preferred meeting time. Tina will contact you shortly to confirm.
          </p>
          <Link to="/" style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, backgroundColor: "#1a3c34", color: "white", textDecoration: "none" }}>
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#f9fafb", minHeight: "100vh", padding: "3rem 1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>Enrollment Registration</h1>
          <p style={{ color: "#6b7280", fontSize: "1.125rem" }}>Provide your details and pick a time to meet with Tina.</p>
        </div>

        {error && (
          <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
            {error}
          </div>
        )}

        {load.state === "loading" && <p style={{ textAlign: "center" }}>Loading schedule…</p>}
        {load.state === "error" && <p style={{ textAlign: "center", color: "red" }}>{load.message}</p>}

        {load.state === "ready" && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* Parent Details Card */}
            <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1.5rem" }}>Parent / Guardian Information</h2>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Full Name *</label>
                  <input required type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Phone *</label>
                  <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px" }} />
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Email Address *</label>
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Home Address *</label>
                <input required type="text" value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px" }} />
              </div>
            </div>

            {/* Calendar Card */}
            <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Select a Meeting Time</h2>
              <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Pick a time to meet with Tina to discuss enrollment.</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem" }}>
                {/* Left: Calendar Grid */}
                <div style={{ flex: "1 1 300px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                    <h3 style={{ fontWeight: 600, fontSize: "1rem", color: "#111827" }}>{formatMonthYear(viewedMonth)}</h3>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="button" onClick={handlePrevMonth} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}>&lsaquo;</button>
                      <button type="button" onClick={handleNextMonth} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}>&rsaquo;</button>
                    </div>
                  </div>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#9ca3af", marginBottom: "1rem" }}>
                    <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
                  </div>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", textAlign: "center", fontSize: "0.9rem" }}>
                    {blanks.map(b => <div key={`blank-${b}`} />)}
                    {days.map((dayNum) => {
                      const dateObj = new Date(year, month, dayNum);
                      const dateString = toYYYYMMDD(dateObj);
                      const hasSlotsOnThisDate = load.value.times.some(time => dateKeyInTimeZone(new Date(time.startsAt), load.value.timeZone) === dateString);
                      const isSelected = selectedDateStr === dateString;

                      return (
                        <div key={dayNum}>
                          {hasSlotsOnThisDate ? (
                             <button type="button" onClick={() => { setSelectedDateStr(dateString); setSelectedSlotId(null); }} style={{ width: "32px", height: "32px", borderRadius: "6px", border: "none", cursor: "pointer", backgroundColor: isSelected ? "#1a3c34" : "#f3f4f6", color: isSelected ? "white" : "#4b5563", fontWeight: 500 }}>{dayNum}</button>
                          ) : ( <div style={{ color: "#d1d5db", padding: "0.35rem 0" }}>{dayNum}</div> )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Time Slots */}
                <div style={{ flex: "1 1 300px" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
                    {selectedDateStr ? new Date(selectedDateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' }) : "Select a day"}
                  </h3>
                  
                  {activeSlots.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.75rem" }}>
                      {activeSlots.map((slot) => {
                        const isSelected = selectedSlotId === slot.id;
                        return (
                          <button type="button" key={slot.id} onClick={() => setSelectedSlotId(slot.id)} style={{ padding: "0.75rem", borderRadius: "6px", fontSize: "0.95rem", cursor: "pointer", color: "#111827", border: isSelected ? "2px solid #1a3c34" : "1px solid #d1d5db", backgroundColor: isSelected ? "#f0fdf4" : "white", fontWeight: isSelected ? 600 : 400 }}>
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: "2rem", textAlign: "center", backgroundColor: "#f9fafb", borderRadius: "8px", color: "#6b7280" }}>
                      No times available on this day.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              style={{
                padding: "1rem",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "1.125rem",
                border: "none",
                backgroundColor: (!isFormValid || isSubmitting) ? "#e5e7eb" : "#1a3c34",
                color: (!isFormValid || isSubmitting) ? "#9ca3af" : "white",
                cursor: (!isFormValid || isSubmitting) ? "not-allowed" : "pointer",
                transition: "background-color 0.2s"
              }}
            >
              {isSubmitting ? "Submitting Request..." : "Submit Registration & Meeting Request"}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.85rem", color: "#6b7280", marginTop: "-1rem" }}>
              This does not book the meeting immediately. TALA will review your details and confirm the time with you via email.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}