import { useMemo } from "react";
import "./sidebar.scss";

interface SidebarProps {
  title?: string;
  eventCount?: number;
}

const Sidebar = ({ 
  title = "Today's Events", 
  eventCount = 10 
}: SidebarProps) => {
  // Memoize event generation to prevent unnecessary re-renders
  const events = useMemo(() => 
    Array.from({ length: eventCount }, (_, index) => ({
      id: index + 1,
      name: `Event ${index + 1}`,
      // Future: Add more event properties like time, teams, etc.
    })), [eventCount]
  );

  return (
    <aside className="sidebar position-fixed p-4" role="complementary" aria-label="Today's events">
      <h2 className="sidebar-title">{title}</h2>
      
      <ul className="list-group mt-4" role="list">
        {events.map((event) => (
          <li 
            key={event.id}
            className="list-group-item border-0"
            role="listitem"
          >
            {event.name}
          </li>
        ))}
      </ul>
    </aside>
  );
};

export default Sidebar;