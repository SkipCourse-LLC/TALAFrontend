import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { ProgramCards } from "./ProgramCards";
import learningDesk from "../assets/learning-desk.svg";

export function HomePage() {
  return (
    <div className="public-page public-home" style={{ backgroundColor: "#f8f9fa" }}>
      
      {/* HERO SECTION */}
      <section className="hero container" style={{ paddingTop: "4rem", paddingBottom: "4rem" }}>
        <div className="hero-copy">
          <p className="eyebrow" style={{ color: "#4b5563", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600, fontSize: "0.85rem", marginBottom: "1rem" }}>
            Tucson Adaptive Learning Academy
          </p>
          <h1 style={{ fontSize: "4rem", lineHeight: 1.1, fontFamily: "Georgia, serif", fontWeight: 500, color: "#111827", letterSpacing: "-0.02em", marginBottom: "1.5rem" }}>
            Room to learn. <br />
            Space to grow.
          </h1>
          <p className="lead" style={{ fontSize: "1.1rem", color: "#4b5563", lineHeight: 1.6, marginBottom: "2rem", maxWidth: "500px" }}>
            A school community taking shape around medically fragile and
            neurodivergent learners. Explore the possibilities, then find a next
            step for your family.
          </p>
          <div className="button-row" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Link to="/register" style={{ backgroundColor: "#1a3c34", color: "white", padding: "0.75rem 1.5rem", borderRadius: "6px", textDecoration: "none", fontWeight: 500 }}>
              Start registration
            </Link>
            <Link to="/programs" style={{ backgroundColor: "white", color: "#111827", border: "1px solid #d1d5db", padding: "0.75rem 1.5rem", borderRadius: "6px", textDecoration: "none", fontWeight: 500 }}>
              Explore programs
            </Link>
            <Link to="/learn-more" style={{ backgroundColor: "white", color: "#111827", border: "1px solid #d1d5db", padding: "0.75rem 1.5rem", borderRadius: "6px", textDecoration: "none", fontWeight: 500 }}>
              Learn more
            </Link>
          </div>
          <p style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "1rem" }}>
            Explore a frontend preview. No application is submitted.
          </p>
        </div>
        
        <figure className="hero-art">
          <img
            src={learningDesk}
            width="600"
            height="570"
            alt="An illustrated learning journal with a seedling, a mountain sketch, and notes to ask, explore, and grow."
          />
          <figcaption className="hero-hub-preview">
            <div className="hero-hub-heading">
              <span className="hero-hub-symbol">
                <Icon name="book" />
              </span>
              <div>
                <strong>Student hub</strong>
                <span>A sample of your learning space</span>
              </div>
            </div>
            <ul>
              <li><Icon name="book" /><span>Learning paths</span></li>
              <li><Icon name="grid" /><span>Personal calendar</span></li>
              <li><Icon name="folder" /><span>Projects &amp; progress</span></li>
            </ul>
            <Link to="/login">
              Preview the student hub <Icon name="arrow" />
            </Link>
          </figcaption>
        </figure>
      </section>

      {/* 3-STEP STRIP */}
      <section className="container" style={{ marginBottom: "4rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "2rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ color: "#1a3c34" }}><Icon name="user" /></div>
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: "0.25rem" }}>Start with your family.</h3>
              <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>Explore a path around the learner.</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ color: "#1a3c34" }}><Icon name="leaf" /></div>
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: "0.25rem" }}>Make room for curiosity.</h3>
              <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>Discover different ways to learn.</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ color: "#1a3c34" }}><Icon name="grid" /></div>
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: "0.25rem" }}>See the next step.</h3>
              <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>Preview learning in one place.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PROGRAMS SECTION */}
      <section className="container" style={{ marginBottom: "5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Programs / Enrollment</p>
            <h2 style={{ fontSize: "2.5rem", fontFamily: "Georgia, serif", fontWeight: 500, color: "#111827", marginBottom: "0.5rem" }}>Different paths. Same curiosity.</h2>
            <p style={{ color: "#6b7280", fontSize: "1rem" }}>Explore early program concepts. Availability and details are still being confirmed.</p>
          </div>
          <Link to="/programs" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#1a3c34", fontWeight: 600, textDecoration: "none" }}>
            View all programs <Icon name="arrow" />
          </Link>
        </div>
        
        <ProgramCards />
      </section>

      {/* ABOUT / COMMUNITY LINKS (Side-by-side cards) */}
      <section className="container" style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginBottom: "5rem" }}>
        
        {/* Left Card - Learn More */}
        <div style={{ flex: "1 1 500px", backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "2.5rem", display: "flex", flexWrap: "wrap", gap: "2rem" }}>
          <div style={{ flex: "1 1 200px" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Learn More</p>
            <h2 style={{ fontSize: "1.75rem", fontFamily: "Georgia, serif", fontWeight: 500, lineHeight: 1.2, color: "#111827" }}>A school taking shape</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.5rem", fontSize: "0.85rem", color: "#4b5563" }}>
              <Icon name="leaf" /> Centered on each learner
            </div>
          </div>
          <div style={{ flex: "1 1 250px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <p style={{ fontSize: "0.95rem", color: "#4b5563", lineHeight: 1.6 }}>
              TALA is planning a flexible blend of in-person and online learning, with each learner's health, dignity and potential at its center. School details and opening plans will be shared once confirmed.
            </p>
            <Link to="/learn-more" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", color: "#1a3c34", fontWeight: 600, textDecoration: "none" }}>
              Let's start a conversation <Icon name="arrow" />
            </Link>
          </div>
        </div>

        {/* Right Card - Community Events */}
        <div style={{ flex: "1 1 300px", backgroundColor: "#0f7e64", borderRadius: "12px", padding: "2.5rem", color: "white", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid white", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.5rem" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "white" }}></div>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontFamily: "Georgia, serif", fontWeight: 500, marginBottom: "0.75rem" }}>A community worth exploring.</h2>
            <p style={{ fontSize: "0.95rem", color: "#d1d5db", lineHeight: 1.6 }}>Follow the ideas behind TALA and discover what comes next.</p>
          </div>
          <Link to="/events" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "2rem", color: "white", fontWeight: 600, textDecoration: "none" }}>
            Community Events <Icon name="arrow" />
          </Link>
        </div>
      </section>

     
      <section className="container" style={{ display: "flex", flexWrap: "wrap", gap: "4rem", marginBottom: "6rem" }}>
        

        <div style={{ flex: "1 1 300px" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "1rem" }}>Contact Us</p>
          <h2 style={{ fontSize: "2.5rem", fontFamily: "Georgia, serif", fontWeight: 500, lineHeight: 1.1, color: "#111827", marginBottom: "1.5rem" }}>
            Big questions.<br/>A simple first step.
          </h2>
          <p style={{ color: "#4b5563", fontSize: "1rem", lineHeight: 1.6, marginBottom: "2rem" }}>
            Interested in TALA? Share a little about yourself and how to reach you. Our team will connect with you to talk about your questions and next steps.
          </p>
          <div style={{ width: "40px", height: "2px", backgroundColor: "#d1d5db", marginBottom: "1.5rem" }}></div>
          <p style={{ fontWeight: 600, color: "#111827", marginBottom: "0.5rem" }}>Let's find your starting point.</p>
          <p style={{ color: "#4b5563", fontSize: "0.9rem", marginBottom: "2rem" }}>
            Ask about learning possibilities, explore the enrollment process, or simply say hello.
          </p>
          <Link to="/login" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#4b5563", fontWeight: 500, fontSize: "0.9rem", textDecoration: "none" }}>
            <Icon name="arrow" /> Already have an account? Community Login above.
          </Link>
        </div>

      
        <div style={{ flex: "1 1 500px", backgroundColor: "white", padding: "2rem", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Tell us about yourself</h3>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>* required fields</span>
          </div>
          <form style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>First name *</label>
                <input type="text" placeholder="Your first name" style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.95rem" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Last name *</label>
                <input type="text" placeholder="Your last name" style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.95rem" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Email address *</label>
                <input type="email" placeholder="you@example.com" style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.95rem" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Phone number (optional)</label>
                <input type="tel" placeholder="(555) 000-0000" style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.95rem" }} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>How can we help? (optional)</label>
              <textarea rows={3} placeholder="Tell us what you'd like to know about TALA..." style={{ width: "100%", padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.95rem", resize: "vertical" }}></textarea>
            </div>
            
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.85rem", color: "#4b5563", marginTop: "0.5rem" }}>
              <input type="checkbox" style={{ marginTop: "0.2rem", accentColor: "#1a3c34" }} />
              <span>I agree that TALA may contact me about my inquiry using the details I've provided. *</span>
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", maxWidth: "250px" }}>
                Your information is shared with our team to respond to your inquiry.
              </p>
              <button type="button" style={{ backgroundColor: "#1a3c34", color: "white", padding: "0.75rem 1.5rem", borderRadius: "6px", fontWeight: 600, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                Send inquiry <Icon name="arrow" />
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}