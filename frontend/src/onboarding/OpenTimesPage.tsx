import { useEffect, useState, useMemo } from "react";
import { safeTalaApiError, talaApi } from "../api";
import type { OpenTimes } from "../api";
import { groupOpenTimes } from "./openTimesFormat";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: OpenTimes };

type MeetingMethod = "zoom" | "phone" | "no_preference";

const toYYYYMMDD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatMonthYear = (date: Date) => {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export function OpenTimesPage() {
  // Wizard State
  const [step, setStep] = useState<"time" | "method" | "details" | "review" | "success">("time");
  
  // Data State
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  
  // Calendar State
  const [viewedMonth, setViewedMonth] = useState(new Date(2026, 10, 1)); 
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  
  // Method State
  const [meetingMethod, setMeetingMethod] = useState<MeetingMethod>("zoom");

  // Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const useMockData = false; 

  const fetchTimes = () => {
    if (useMockData) return;
    const controller = new AbortController();
    
    talaApi
      .getPublicOpenTimes(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoad({ state: "ready", value });
          if (value.times.length > 0 && value.times[0] && !selectedDateStr) {
             const firstDate = new Date(value.times[0].startsAt);
             setSelectedDateStr(toYYYYMMDD(firstDate));
             setViewedMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoad({ state: "error", message: safeTalaApiError(error).message });
      });
    return () => controller.abort();
  };

  useEffect(() => {
    return fetchTimes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, useMockData]);

  const groupedDays = useMemo(() => {
    if (load.state !== "ready") return [];
    return groupOpenTimes(load.value);
  }, [load]);

  const activeSlots = groupedDays.flatMap(day => day.times).filter(slot => {
    if (!selectedDateStr || load.state !== "ready") return false;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: load.value.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(slot.startsAt));
    const part = (type: string) => parts.find(value => value.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}` === selectedDateStr;
  });
  const selectedSlot = activeSlots.find(s => s.id === selectedSlotId);

  // --- CALENDAR MATH ---
  const year = viewedMonth.getFullYear();
  const month = viewedMonth.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); 
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const handlePrevMonth = () => { setViewedMonth(new Date(year, month - 1, 1)); setSelectedDateStr(null); setSelectedSlotId(null); };
  const handleNextMonth = () => { setViewedMonth(new Date(year, month + 1, 1)); setSelectedDateStr(null); setSelectedSlotId(null); };

  const phoneDigits = phone.replace(/\D/g, "").length;
  const isFormValid =
    name.trim().length > 0 &&
    email.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    phone.trim().length <= 30 &&
    /^[0-9+().\s-]+$/.test(phone.trim()) &&
    phoneDigits >= 10 &&
    phoneDigits <= 15;

  const handleConfirmBooking = async () => {
    if (!selectedSlotId) return;
    setIsSubmitting(true);
    setErrorMsg("");

    try {
      // NOTE: Replace with your real API call to reserve the appointment
      // await talaApi.reservePublicAppointment({ slotId: selectedSlotId, meetingMethod, parentDetails: { name, email, phone } });
      
      // Simulating network delay for UI feedback
      await new Promise(resolve => setTimeout(resolve, 1000));

      setStep("success");
      fetchTimes(); // Refresh so the taken slot disappears
    } catch (error) {
      // Handle concurrency conflict (someone else took the slot)
      setErrorMsg("That time was just booked by someone else. Please select another time.");
      setSelectedSlotId(null);
      setStep("time");
      fetchTimes();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (load.state === "loading") return <div style={{ padding: "3rem", textAlign: "center" }}>Loading…</div>;
  if (load.state === "error") return <div style={{ padding: "3rem", textAlign: "center", color: "red" }}>Error: {load.message}</div>;

  const displayDate = selectedDateStr ? new Date(selectedDateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : "";
  const displayMethod = meetingMethod === "zoom" ? "Zoom Video" : meetingMethod === "phone" ? "Phone Call" : "No preference";

  return (
    <div style={{ backgroundColor: "#f9fafb", minHeight: "100vh", padding: "3rem 1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "750px", margin: "0 auto" }}>
        
        {/* STEP 1: TIME SELECTION */}
        {step === "time" && (
          <>
            <div style={{ marginBottom: "2rem" }}>
              {errorMsg && (
                <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
                  <strong>Heads up!</strong> {errorMsg}
                </div>
              )}
              <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>
                {activeSlots.length > 0 ? "Open meeting times" : "Nothing open just yet."}
              </h1>
              <p style={{ color: "#6b7280", fontSize: "1.125rem" }}>
                {activeSlots.length > 0 ? "These are the times TALA has open for a first conversation." : `No slots available in ${formatMonthYear(viewedMonth)}.`}
              </p>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", alignItems: "stretch" }}>
              <div style={{ flex: "1 1 350px", backgroundColor: "white", padding: "2rem", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                  <h2 style={{ fontWeight: 600, fontSize: "1.125rem", color: "#111827" }}>{formatMonthYear(viewedMonth)}</h2>
                  <div style={{ display: "flex", gap: "0.5rem", color: "#9ca3af" }}>
                    <button onClick={handlePrevMonth} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}>&lsaquo;</button>
                    <button onClick={handleNextMonth} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}>&rsaquo;</button>
                  </div>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#9ca3af", marginBottom: "1rem" }}>
                  <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", textAlign: "center", fontSize: "0.9rem", color: "#4b5563" }}>
                  {blanks.map(b => <div key={`blank-${b}`} />)}
                  {days.map((dayNum) => {
                    const dateObj = new Date(year, month, dayNum);
                    const dateString = toYYYYMMDD(dateObj);
                    const hasSlotsOnThisDate = load.state === "ready" && load.value.times.some(time => toYYYYMMDD(new Date(time.startsAt)) === dateString);
                    const isSelected = selectedDateStr === dateString;

                    return (
                      <div key={dayNum}>
                        {hasSlotsOnThisDate ? (
                           <button onClick={() => { setSelectedDateStr(dateString); setSelectedSlotId(null); }} style={{ width: "32px", height: "32px", borderRadius: "6px", border: "none", cursor: "pointer", backgroundColor: isSelected ? "#1a3c34" : "#f3f4f6", color: isSelected ? "white" : "#4b5563", fontWeight: 500 }}>{dayNum}</button>
                        ) : ( <div style={{ color: "#d1d5db", padding: "0.35rem 0" }}>{dayNum}</div> )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column" }}>
                {activeSlots.length > 0 ? (
                  <>
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem", color: "#111827" }}>
                      {selectedDateStr && new Date(selectedDateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.75rem" }}>
                      {activeSlots.map((slot) => {
                        const isSelected = selectedSlotId === slot.id;
                        return (
                          <button key={slot.id} onClick={() => setSelectedSlotId(slot.id)} style={{ padding: "0.75rem", borderRadius: "6px", fontSize: "0.95rem", cursor: "pointer", color: "#111827", border: isSelected ? "1px solid #111827" : "1px solid #d1d5db", backgroundColor: isSelected ? "#f3f4f6" : "white", fontWeight: isSelected ? 600 : 400 }}>
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "2rem", textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>A little pause in the calendar.</h2>
                    <p style={{ color: "#4b5563", fontSize: "0.95rem", lineHeight: 1.5 }}>Tina's {formatMonthYear(viewedMonth).split(" ")[0]} appointments are full.</p>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: "2rem", display: "flex", justifyContent: "flex-end" }}>
              <button disabled={!selectedSlotId} onClick={() => { setErrorMsg(""); setStep("method"); }} style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, border: "none", backgroundColor: selectedSlotId ? "#111827" : "#e5e7eb", color: selectedSlotId ? "white" : "#9ca3af", cursor: selectedSlotId ? "pointer" : "not-allowed" }}>Continue</button>
            </div>
          </>
        )}

        {/* STEP 2: METHOD SELECTION */}
        {step === "method" && (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>How shall we connect?</h1>
              <p style={{ color: "#6b7280", fontSize: "1.125rem" }}>Choose the way you'd feel most comfortable meeting.</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ color: "#166534" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#166534", margin: 0 }}>{displayDate}</p>
                  <p style={{ color: "#15803d", fontSize: "0.85rem", margin: 0 }}>{selectedSlot?.label} • 30 minutes • EST</p>
                </div>
              </div>

              {(["zoom", "phone", "no_preference"] as MeetingMethod[]).map((m) => {
                const label = m === "zoom" ? "Zoom Video" : m === "phone" ? "Phone Call" : "No preference";
                const desc = m === "zoom" ? "Meet face-to-face, wherever you are. We'll email you your link." : m === "phone" ? "Tina will call the phone number you provide." : "Let Tina choose. Your confirmation will include the details.";
                return (
                  <label key={m} style={{ border: meetingMethod === m ? "2px solid #1a3c34" : "1px solid #d1d5db", backgroundColor: meetingMethod === m ? "#f0fdf4" : "white", padding: "1.25rem", borderRadius: "8px", display: "flex", alignItems: "flex-start", gap: "1rem", cursor: "pointer" }}>
                    <input type="radio" name="method" checked={meetingMethod === m} onChange={() => setMeetingMethod(m)} style={{ marginTop: "0.25rem" }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 600, color: "#111827", margin: "0 0 0.25rem 0" }}>{label}</p>
                      <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>{desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => setStep("time")} style={{ background: "none", border: "none", color: "#4b5563", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>&larr; Back</button>
              <button onClick={() => setStep("details")} style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, border: "none", backgroundColor: "#1a3c34", color: "white", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>Continue &rarr;</button>
            </div>
          </>
        )}

        {/* STEP 3: CONTACT DETAILS */}
        {step === "details" && (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>Your Contact Details</h1>
              <p style={{ color: "#6b7280", fontSize: "1.125rem" }}>Tell Tina how to reach you. All fields are required.</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ color: "#166534" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#166534", margin: 0 }}>{displayDate}</p>
                  <p style={{ color: "#15803d", fontSize: "0.85rem", margin: 0 }}>{selectedSlot?.label} • 30 minutes • EST</p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Name *</label>
                  <div style={{ position: "relative" }}>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "1rem" }} />
                    {name.trim().length > 0 && <span style={{ position: "absolute", right: "10px", top: "12px", color: "#166534" }}>✓</span>}
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Phone *</label>
                  <div style={{ position: "relative" }}>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "1rem" }} />
                    {phone.trim().length >= 7 && <span style={{ position: "absolute", right: "10px", top: "12px", color: "#166534" }}>✓</span>}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Email *</label>
                <div style={{ position: "relative" }}>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "1rem" }} />
                  {email.includes("@") && <span style={{ position: "absolute", right: "10px", top: "12px", color: "#166534" }}>✓</span>}
                </div>
                <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.5rem" }}>We'll send your confirmation and Zoom link here.</p>
              </div>

              <div style={{ fontSize: "0.9rem", color: "#4b5563", display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                Meeting Method: {displayMethod}
              </div>

              <p style={{ fontSize: "0.85rem", color: "#6b7280", borderTop: "1px solid #e5e7eb", paddingTop: "1rem", marginTop: "1rem" }}>
                Your details are only used to arrange this meeting. No mailing lists, no unexpected messages.
              </p>
            </div>

            <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => setStep("method")} style={{ background: "none", border: "none", color: "#4b5563", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>&larr; Back</button>
              <div style={{ textAlign: "right" }}>
                <button disabled={!isFormValid} onClick={() => setStep("review")} style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, border: "none", backgroundColor: isFormValid ? "#1a3c34" : "#e5e7eb", color: isFormValid ? "white" : "#9ca3af", cursor: isFormValid ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: "0.5rem" }}>Continue &rarr;</button>
                <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>Your appointment is not booked until you confirm.</p>
              </div>
            </div>
          </>
        )}

        {/* STEP 4: REVIEW */}
        {step === "review" && (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>Everything look right?</h1>
              <p style={{ color: "#6b7280", fontSize: "1.125rem", marginBottom: "1.5rem" }}>Take a moment to review. Your appointment is not booked yet.</p>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <div style={{ width: "16px", height: "16px", border: "2px solid #9ca3af", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: "6px", height: "6px", backgroundColor: "#9ca3af", borderRadius: "50%" }}></div></div>
                Ready to confirm • Not yet booked
              </div>
            </div>

            <div style={{ backgroundColor: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "0 2rem" }}>
              <div style={{ padding: "1.5rem 0", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#111827" }}>Your meeting with Tina</h3>
                  <button onClick={() => setStep("time")} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "0.875rem", textDecoration: "underline", cursor: "pointer" }}>Edit</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.75rem", fontSize: "0.95rem" }}>
                  <div style={{ color: "#6b7280" }}>Date</div>
                  <div style={{ color: "#111827" }}>{displayDate}</div>
                  <div style={{ color: "#6b7280" }}>Time</div>
                  <div style={{ color: "#111827" }}>{selectedSlot?.label} • 30 minutes</div>
                  <div style={{ color: "#6b7280" }}>Timezone</div>
                  <div style={{ color: "#111827" }}>Eastern Time (UTC-05:00)</div>
                  <div style={{ color: "#6b7280" }}>Meeting Method</div>
                  <div style={{ color: "#111827" }}>{displayMethod}</div>
                </div>
              </div>

              <div style={{ padding: "1.5rem 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#111827" }}>Your contact details</h3>
                  <button onClick={() => setStep("details")} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "0.875rem", textDecoration: "underline", cursor: "pointer" }}>Edit</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.75rem", fontSize: "0.95rem" }}>
                  <div style={{ color: "#6b7280" }}>Name</div>
                  <div style={{ color: "#111827" }}>{name}</div>
                  <div style={{ color: "#6b7280" }}>Phone</div>
                  <div style={{ color: "#111827" }}>{phone}</div>
                  <div style={{ color: "#6b7280" }}>Email</div>
                  <div style={{ color: "#111827" }}>{email}</div>
                </div>
              </div>
            </div>

            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "1.5rem" }}>
              Once confirmed, your appointment details and Zoom link will be sent to <strong>{email}</strong>.
            </p>

            <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button disabled={isSubmitting} onClick={() => setStep("details")} style={{ background: "none", border: "none", color: "#4b5563", fontWeight: 500, cursor: isSubmitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>&larr; Back</button>
              <div style={{ textAlign: "right" }}>
                <button disabled={isSubmitting} onClick={handleConfirmBooking} style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, border: "none", backgroundColor: "#1a3c34", color: "white", cursor: isSubmitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {isSubmitting ? "Booking..." : "Confirm booking"}
                </button>
                <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>By confirming, you'll book this 30-minute meeting with Tina.</p>
              </div>
            </div>
          </>
        )}

        {/* STEP 5: SUCCESS */}
        {step === "success" && (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "2.5rem", fontWeight: 500, color: "#111827", marginBottom: "0.5rem", fontFamily: "Georgia, serif" }}>You're booked!</h1>
              <p style={{ color: "#6b7280", fontSize: "1.125rem", marginBottom: "1.5rem" }}>It's official, {name.split(" ")[0]}. Tina is looking forward to your conversation.</p>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Confirmed • Your time is reserved
              </div>
            </div>

            <div style={{ backgroundColor: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "2rem" }}>
              <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ color: "#166534" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#166534", margin: 0 }}>{displayDate}</p>
                  <p style={{ color: "#15803d", fontSize: "0.85rem", margin: 0 }}>{selectedSlot?.label} • 30 minutes • EST</p>
                </div>
              </div>

              <div style={{ fontSize: "0.95rem", color: "#111827", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.5rem" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                <strong>{displayMethod} with Tina</strong>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.5rem", fontSize: "0.95rem" }}>
                <p style={{ fontWeight: 600, color: "#111827", marginBottom: "0.25rem" }}>{name}</p>
                <p style={{ color: "#6b7280" }}>{email} • {phone}</p>
              </div>
            </div>

            <div style={{ marginTop: "2rem" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "1rem" }}>A few things before we meet</p>
              
              <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ color: "#4b5563", marginTop: "0.2rem" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#111827", fontSize: "0.95rem", margin: "0 0 0.25rem 0" }}>Your Zoom link is in your inbox</p>
                  <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>A Zoom link has been sent to {email}, along with your confirmation.</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ color: "#4b5563", marginTop: "0.2rem" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#111827", fontSize: "0.95rem", margin: "0 0 0.25rem 0" }}>Join a few minutes early</p>
                  <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>Open the link in your email. Bring your questions; Tina will take care of the rest.</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem" }}>
                <div style={{ color: "#4b5563", marginTop: "0.2rem" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg></div>
                <div>
                  <p style={{ fontWeight: 600, color: "#111827", fontSize: "0.95rem", margin: "0 0 0.25rem 0" }}>Plans change. That's okay.</p>
                  <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>Use the reschedule or cancel options in your confirmation email if you need to make a change.</p>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <button onClick={() => window.location.href = "/"} style={{ background: "none", border: "none", color: "#4b5563", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>&larr; Back to home</button>
                <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>Need a hand? Reply to your confirmation email and Tina will help.</p>
              </div>
              <button onClick={() => alert("Add to calendar clicked")} style={{ padding: "0.75rem 2rem", borderRadius: "6px", fontWeight: 500, border: "none", backgroundColor: "#1a3c34", color: "white", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>Add to calendar &rarr;</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}