import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";

export function ProgramCards() {
  const programs = [
    {
      icon: "book",
      category: "One-on-one tutoring",
      title: "Learning at your pace",
      description: "A little extra space to ask questions, work through challenges, and build understanding.",
      linkText: "Explore one-on-one tutoring",
    },
    {
      icon: "people",
      category: "Group courses",
      title: "Better, together",
      description: "Make room for new perspectives. Explore ideas and learn alongside other curious minds.",
      linkText: "Explore group courses",
    },
    {
      icon: "leaf",
      category: "Experiential learning",
      title: "Beyond the classroom",
      description: "Connect learning with the world around you through outdoor and animal-related experiences.",
      linkText: "Explore experiential learning",
    },
    {
      icon: "voice",
      category: "Interview consulting",
      title: "Show up as yourself",
      description: "Find the words for your ideas and practice sharing your story with greater clarity.",
      linkText: "Explore interview consulting",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
      {programs.map((program) => (
        <div 
          key={program.title}
          style={{
            backgroundColor: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "300px"
          }}
        >
          <div>
            {/* Icon Box */}
            <div style={{ 
              width: "40px", 
              height: "40px", 
              backgroundColor: "#f9fafb", 
              borderRadius: "8px", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              marginBottom: "1.5rem",
              color: "#1a3c34"
            }}>
              <Icon name={program.icon as any} />
            </div>
            
            {/* Text Content */}
            <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              {program.category}
            </p>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#111827", marginBottom: "0.75rem", fontFamily: "Georgia, serif" }}>
              {program.title}
            </h3>
            <p style={{ fontSize: "0.9rem", color: "#4b5563", lineHeight: 1.5 }}>
              {program.description}
            </p>
          </div>

          {/* Link */}
          <Link 
            to="/programs" 
            style={{ 
              display: "inline-flex", 
              alignItems: "center", 
              gap: "0.5rem", 
              marginTop: "2rem",
              color: "#1a3c34", 
              fontSize: "0.85rem", 
              fontWeight: 600, 
              textDecoration: "none" 
            }}
          >
            {program.linkText} <Icon name="arrow" />
          </Link>
        </div>
      ))}
    </div>
  );
}