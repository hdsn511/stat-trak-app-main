import { useState, useEffect } from "react";
interface Streak {

}

const HotStreaks: React.FC = () => {
  const [streaks, setStreaks] = useState<Streak[]>([]);

  useEffect(() => {
    // Fetch hot streaks data from an API or service
    const fetchStreaks = async () => {
      // Simulated fetch
      const data: Streak[] = [
        {},
      ];
      setStreaks(data);
    };

    fetchStreaks();
  }, []);

  return (
    <div className="hot-streaks">
      <h2>Hot Streaks</h2>
      <ul>
        {streaks.map((streak, index) => (
          <li key={index}>{/* Render streak details */}</li>
        ))}
      </ul>
    </div>
  );
};
export default HotStreaks;